"use server";

import { withDbRetry } from "@/lib/db";
import { logStart } from "@/lib/app-logging";
import { requireActor } from "@/features/auth/session";
import { insertChangeLog } from "../change-log";
import { userCommand } from "../command-stack";
import { lockEditableSandbox, UUID_RE } from "../lock";
import {
  ackTouched,
  logSandboxActionRejection,
  logSandboxActionOutcome,
  type ActionErr,
  type ActionOk,
  type ActionResult,
} from "./shared";
import {
  isInSubtree,
  resequenceSiblings,
  rejectAssistantParent,
  type NodeRow,
} from "./structure";

export type MoveMemberTarget =
  | { kind: "peer"; seatId: string }
  | {
      kind: "new-seat";
      parentId: string;
      beforeSiblingId: string | null;
      nodeId?: string;
      asAssistant?: boolean;
    };

/** Member drag: move ONE person out of a seat — onto
 *  another seat as a peer, or into a brand-new seat at the drop position.
 *  Emptying the source dissolves it (children splice up, delete_seat); a
 *  departing host promotes the next member (set_peer_host). */
export async function moveMember(args: {
  treeId: string;
  sourceSeatId: string;
  employeeAuthId: string;
  expectedRowVersion: number;
  target: MoveMemberTarget;
}): Promise<ActionResult> {
  const startedAt = logStart();
  const { treeId, sourceSeatId, employeeAuthId, expectedRowVersion, target } = args;
  const targetNodeId = target.kind === "peer" ? target.seatId : target.parentId;
  if (
    ![treeId, sourceSeatId, employeeAuthId, targetNodeId].every((id) =>
      UUID_RE.test(id),
    )
  ) {
    logSandboxActionRejection({
      operation: "move_member",
      eventName: "sandbox.member_move.result",
      failureReason: "Malformed id",
      startedAt,
      fields: {
        validation_target: "tree_id,source_seat_id,employee_auth_id,target_node_id",
        target_kind: target.kind,
      },
    });
    return { ok: false, reason: "Malformed id" };
  }
  if (
    target.kind === "new-seat" &&
    ((target.beforeSiblingId !== null && !UUID_RE.test(target.beforeSiblingId)) ||
      (target.nodeId !== undefined && !UUID_RE.test(target.nodeId)))
  ) {
    logSandboxActionRejection({
      operation: "move_member",
      eventName: "sandbox.member_move.result",
      failureReason: "Malformed id",
      startedAt,
      treeId,
      nodeId: sourceSeatId,
      fields: {
        target_node_id: targetNodeId,
        validation_target: "before_sibling_id,node_id",
        target_kind: target.kind,
      },
    });
    return { ok: false, reason: "Malformed id" };
  }
  const expected = Number(expectedRowVersion);
  if (!Number.isSafeInteger(expected) || expected < 1) {
    logSandboxActionRejection({
      operation: "move_member",
      eventName: "sandbox.member_move.result",
      failureReason: "Bad version",
      startedAt,
      treeId,
      nodeId: sourceSeatId,
      fields: {
        target_node_id: targetNodeId,
        target_kind: target.kind,
        expected_row_version: expectedRowVersion,
      },
    });
    return { ok: false, reason: "Bad version" };
  }
  const access = await requireActor();
  if (!access.ok) {
    logSandboxActionRejection({
      operation: "move_member",
      eventName: "sandbox.member_move.result",
      failureReason: "Not allowed",
      startedAt,
      treeId,
      nodeId: sourceSeatId,
      fields: {
        auth_status: access.status,
        target_node_id: targetNodeId,
        target_kind: target.kind,
        expected_row_version: expected,
      },
    });
    return { ok: false, reason: "Not allowed" };
  }
  const actor = access.actor.authId;

  const result: ActionResult = await withDbRetry<ActionResult>(
    async (sql) => {
      let committed: ActionOk | null = null;
      let rejected: ActionErr | null = null;
      await sql.begin(async (tx) => {
        const denied = await lockEditableSandbox(tx, treeId, access.actor);
        if (denied) {
          rejected = denied;
          return;
        }
        const command = userCommand();
        const nodes = (await tx`
        select node_id, parent_node_id, node_type, sort_order, row_version, job_title
        from organelle.nodes
        where tree_id = ${treeId} and node_id in (${sourceSeatId}, ${targetNodeId})
        for update
      `) as unknown as (NodeRow & { job_title: string | null })[];
        const source = nodes.find((n) => n.node_id === sourceSeatId);
        const targetNode = nodes.find((n) => n.node_id === targetNodeId);
        if (!source || !targetNode) {
          rejected = { ok: false, reason: "Node no longer exists — reload" };
          return;
        }
        if (source.node_type !== "seat") {
          rejected = { ok: false, reason: "Not a seat" };
          return;
        }
        if (Number(source.row_version) !== expected) {
          rejected = { ok: false, reason: "Someone else moved this — reload" };
          return;
        }

        const assignment = (await tx`
        select is_host from organelle.seat_assignments
        where tree_id = ${treeId} and node_id = ${sourceSeatId} and employee_auth_id = ${employeeAuthId}
        for update
      `) as unknown as { is_host: boolean }[];
        const wasHost = assignment[0]?.is_host;
        if (wasHost === undefined) {
          rejected = { ok: false, reason: "Not on this seat" };
          return;
        }

        const [countRow] = (await tx`
        select count(*)::int as n from organelle.seat_assignments
        where tree_id = ${treeId} and node_id = ${sourceSeatId}
      `) as unknown as { n: number }[];
        const emptiesSource = countRow!.n === 1;
        if (emptiesSource && source.parent_node_id === null) {
          rejected = {
            ok: false,
            reason: "Can't move the last member off the root seat",
          };
          return;
        }
        const touched = new Set<string>([sourceSeatId, targetNodeId]);

        if (target.kind === "peer") {
          if (targetNode.node_type !== "seat") {
            rejected = { ok: false, reason: "Can't merge into a team" };
            return;
          }
          if (target.seatId === sourceSeatId) {
            rejected = { ok: false, reason: "Already on this seat" };
            return;
          }
          const dupe = (await tx`
          select 1 as hit from organelle.seat_assignments
          where tree_id = ${treeId} and node_id = ${target.seatId} and employee_auth_id = ${employeeAuthId}
        `) as unknown as { hit: number }[];
          if (dupe.length > 0) {
            rejected = { ok: false, reason: "Already on that seat" };
            return;
          }
        } else {
          // Depth pre-check for the seat about to be created (walks
          // parent_node_id); validate_tree remains the final assertion.
          const [depthRow] = (await tx`
          with recursive walk as (
            select n.node_id, n.parent_node_id, 1 as depth, array[n.node_id] as seen
              from organelle.nodes n
             where n.tree_id = ${treeId} and n.node_id = ${target.parentId}
            union all
            select p.node_id, p.parent_node_id, w.depth + 1, w.seen || p.node_id
              from organelle.nodes p
              join walk w on p.node_id = w.parent_node_id
             where p.tree_id = ${treeId}
               and p.node_id <> all (w.seen)
               and w.depth <= 32
          )
          select max(depth)::int as d from walk
        `) as unknown as { d: number }[];
          if ((depthRow?.d ?? 0) + 1 > 16) {
            rejected = {
              ok: false,
              reason: "Too deep — the tree can't exceed 16 levels",
            };
            return;
          }
          if (target.asAssistant) {
            const blocked = await rejectAssistantParent(tx, treeId, target.parentId);
            if (blocked) {
              rejected = blocked;
              return;
            }
          }
        }

        // Remove from the source seat.
        await tx`
        delete from organelle.seat_assignments
        where tree_id = ${treeId} and node_id = ${sourceSeatId} and employee_auth_id = ${employeeAuthId}
      `;
        await insertChangeLog(tx, {
          treeId,
          actor,
          op: "unassign_employee",
          nodeId: sourceSeatId,
          employeeAuthId,
          before: { is_host: wasHost },
          command,
        });

        // Place on the target.
        if (target.kind === "peer") {
          await tx`
          insert into organelle.seat_assignments (tree_id, node_id, employee_auth_id, is_host)
          values (${treeId}, ${target.seatId}, ${employeeAuthId}, false)
        `;
          await insertChangeLog(tx, {
            treeId,
            actor,
            op: "assign_employee",
            nodeId: target.seatId,
            employeeAuthId,
            after: { is_host: false },
            command,
          });
        } else {
          const [employee] = (await tx`
          select job_title from organelle.employees where auth_id = ${employeeAuthId}
        `) as unknown as { job_title: string | null }[];
          const siblings = (await tx`
          select node_id from organelle.nodes
          where tree_id = ${treeId} and parent_node_id = ${target.parentId}
          order by sort_order
        `) as unknown as { node_id: string }[];
          const order = siblings.map((sibling) => sibling.node_id);
          const insertAt =
            target.beforeSiblingId && order.includes(target.beforeSiblingId)
              ? order.indexOf(target.beforeSiblingId)
              : order.length;
          const newSeatId = target.nodeId ?? crypto.randomUUID();
          touched.add(newSeatId);
          await tx`
          insert into organelle.nodes
            (tree_id, node_id, parent_node_id, node_type, sort_order, job_title, is_assistant)
          values (
            ${treeId}, ${newSeatId}, ${target.parentId}, 'seat', ${insertAt},
            ${employee?.job_title ?? "New position"}, ${Boolean(target.asAssistant)}
          )
        `;
          order.splice(insertAt, 0, newSeatId);
          await resequenceSiblings(tx, treeId, order);
          order.forEach((id) => touched.add(id));
          await tx`
          insert into organelle.seat_assignments (tree_id, node_id, employee_auth_id, is_host)
          values (${treeId}, ${newSeatId}, ${employeeAuthId}, true)
        `;
          await insertChangeLog(tx, {
            treeId,
            actor,
            op: "create_seat",
            nodeId: newSeatId,
            employeeAuthId,
            after: {
              parent_node_id: target.parentId,
              job_title: employee?.job_title ?? "New position",
              sort_order: insertAt,
              ...(target.asAssistant ? { is_assistant: true } : {}),
            },
            command,
          });
        }

        // Aftermath on the source seat.
        if (emptiesSource) {
          // Dissolve: children splice into the grandparent at the
          // source's former position — same rule as deleteNode.
          const grandparentId = source.parent_node_id!;
          const children = (await tx`
          select node_id from organelle.nodes
          where tree_id = ${treeId} and parent_node_id = ${sourceSeatId}
          order by sort_order
        `) as unknown as { node_id: string }[];
          const childIds = children.map((child) => child.node_id);
          const grandSiblings = (await tx`
          select node_id from organelle.nodes
          where tree_id = ${treeId} and parent_node_id = ${grandparentId} and node_id <> ${sourceSeatId}
          order by sort_order
        `) as unknown as { node_id: string }[];
          const order = grandSiblings.map((sibling) => sibling.node_id);
          const insertAt = Math.min(source.sort_order, order.length);
          order.splice(insertAt, 0, ...childIds);
          if (childIds.length > 0) {
            await tx`
            update organelle.nodes set parent_node_id = ${grandparentId}
            where tree_id = ${treeId} and parent_node_id = ${sourceSeatId}
          `;
          }
          await tx`
          delete from organelle.nodes
          where tree_id = ${treeId} and node_id = ${sourceSeatId}
        `;
          await resequenceSiblings(tx, treeId, order);
          order.forEach((id) => touched.add(id));
          touched.delete(sourceSeatId);
          await insertChangeLog(tx, {
            treeId,
            actor,
            op: "delete_seat",
            nodeId: sourceSeatId,
            before: {
              parent_node_id: grandparentId,
              job_title: source.job_title,
              members: [],
              sort_order: source.sort_order,
            },
            after: { reparented: childIds },
            command,
          });
        } else if (wasHost) {
          const [next] = (await tx`
          select employee_auth_id from organelle.seat_assignments
          where tree_id = ${treeId} and node_id = ${sourceSeatId}
          order by assigned_at
          limit 1
        `) as unknown as { employee_auth_id: string }[];
          await tx`
          update organelle.seat_assignments set is_host = true
          where tree_id = ${treeId} and node_id = ${sourceSeatId} and employee_auth_id = ${next!.employee_auth_id}
        `;
          await insertChangeLog(tx, {
            treeId,
            actor,
            op: "set_peer_host",
            nodeId: sourceSeatId,
            employeeAuthId: next!.employee_auth_id,
            before: { previous_host: employeeAuthId },
            after: { is_host: true },
            command,
          });
        }

        await tx`select organelle.refresh_primary(${treeId}, ${employeeAuthId}, ${actor})`;
        await tx`select organelle.validate_tree(${treeId})`;
        committed = await ackTouched(tx, treeId, touched, command.commandId);
      });
      return committed ?? rejected ?? { ok: false, reason: "Unknown failure" };
    },
    {
      logger: "sandbox.actions",
      operation: "move_member",
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        tree_id: treeId,
        node_id: sourceSeatId,
        target_node_id: targetNodeId,
        target_kind: target.kind,
        expected_row_version: expected,
      },
    },
  );
  logSandboxActionOutcome({
    operation: "move_member",
    eventName: "sandbox.member_move.result",
    result,
    startedAt,
    actorAuthId: actor,
    actorRole: access.actor.role,
    treeId,
    nodeId: sourceSeatId,
    fields: {
      target_node_id: targetNodeId,
      target_kind: target.kind,
      expected_row_version: expected,
    },
  });
  return result;
}

export async function joinPeer(args: {
  treeId: string;
  sourceSeatId: string;
  targetSeatId: string;
  expectedRowVersion: number;
}): Promise<ActionResult> {
  const startedAt = logStart();
  const { treeId, sourceSeatId, targetSeatId, expectedRowVersion } = args;
  if (![treeId, sourceSeatId, targetSeatId].every((id) => UUID_RE.test(id))) {
    logSandboxActionRejection({
      operation: "join_peer",
      eventName: "sandbox.peer_join.result",
      failureReason: "Malformed id",
      startedAt,
      fields: {
        validation_target: "tree_id,source_seat_id,target_seat_id",
      },
    });
    return { ok: false, reason: "Malformed id" };
  }
  const access = await requireActor();
  if (!access.ok) {
    logSandboxActionRejection({
      operation: "join_peer",
      eventName: "sandbox.peer_join.result",
      failureReason: "Not allowed",
      startedAt,
      treeId,
      nodeId: sourceSeatId,
      fields: {
        auth_status: access.status,
        target_node_id: targetSeatId,
        expected_row_version: Number(expectedRowVersion),
      },
    });
    return { ok: false, reason: "Not allowed" };
  }
  const actor = access.actor.authId;

  const result: ActionResult = await withDbRetry<ActionResult>(
    async (sql) => {
      let committed: ActionOk | null = null;
      let rejected: ActionErr | null = null;
      await sql.begin(async (tx) => {
        const denied = await lockEditableSandbox(tx, treeId, access.actor);
        if (denied) {
          rejected = denied;
          return;
        }
        const command = userCommand();
        const nodes = (await tx`
        select node_id, parent_node_id, node_type, sort_order, row_version, is_assistant
        from organelle.nodes
        where tree_id = ${treeId} and node_id in (${sourceSeatId}, ${targetSeatId})
        for update
      `) as unknown as (NodeRow & { is_assistant: boolean })[];
        const source = nodes.find((n) => n.node_id === sourceSeatId);
        const target = nodes.find((n) => n.node_id === targetSeatId);
        if (!source || !target) {
          rejected = { ok: false, reason: "Node no longer exists — reload" };
          return;
        }
        if (source.node_type !== "seat" || target.node_type !== "seat") {
          rejected = { ok: false, reason: "Can't merge a team into a seat" };
          return;
        }
        if (target.is_assistant) {
          rejected = { ok: false, reason: "Can't add a peer to an assistant" };
          return;
        }
        if (source.parent_node_id === null) {
          rejected = { ok: false, reason: "Can't move the root" };
          return;
        }
        if (Number(source.row_version) !== Number(expectedRowVersion)) {
          rejected = { ok: false, reason: "Someone else moved this — reload" };
          return;
        }
        if (await isInSubtree(tx, treeId, sourceSeatId, targetSeatId)) {
          rejected = { ok: false, reason: "Can't move a node into its own team" };
          return;
        }

        const members = (await tx`
        select employee_auth_id from organelle.seat_assignments
        where tree_id = ${treeId} and node_id = ${sourceSeatId}
      `) as unknown as { employee_auth_id: string }[];
        const targetMembers = (await tx`
        select employee_auth_id from organelle.seat_assignments
        where tree_id = ${treeId} and node_id = ${targetSeatId}
      `) as unknown as { employee_auth_id: string }[];
        const onTarget = new Set(targetMembers.map((m) => m.employee_auth_id));
        if (members.some((m) => onTarget.has(m.employee_auth_id))) {
          rejected = { ok: false, reason: "Already on that seat" };
          return;
        }

        // Members join the target as peers; the host is unchanged.
        for (const member of members) {
          await tx`
          insert into organelle.seat_assignments (tree_id, node_id, employee_auth_id, is_host)
          values (${treeId}, ${targetSeatId}, ${member.employee_auth_id}, false)
        `;
          await insertChangeLog(tx, {
            treeId,
            actor,
            op: "assign_employee",
            nodeId: targetSeatId,
            employeeAuthId: member.employee_auth_id,
            after: { is_host: false },
            command,
          });
        }

        // The source seat's children reparent to its parent, appended last.
        const sourceChildren = (await tx`
        select node_id from organelle.nodes
        where tree_id = ${treeId} and parent_node_id = ${sourceSeatId}
        order by sort_order
      `) as unknown as { node_id: string }[];
        const newSiblings = (await tx`
        select node_id from organelle.nodes
        where tree_id = ${treeId} and parent_node_id = ${source.parent_node_id}
          and node_id <> ${sourceSeatId}
        order by sort_order
      `) as unknown as { node_id: string }[];
        const order = newSiblings.map((s) => s.node_id);
        for (const child of sourceChildren) {
          order.push(child.node_id);
          await tx`
          update organelle.nodes set parent_node_id = ${source.parent_node_id}
          where tree_id = ${treeId} and node_id = ${child.node_id}
        `;
        }
        await resequenceSiblings(tx, treeId, order);

        const sourceMeta = (await tx`
        select job_title from organelle.nodes
        where tree_id = ${treeId} and node_id = ${sourceSeatId}
      `) as unknown as { job_title: string | null }[];
        await tx`
        delete from organelle.nodes
        where tree_id = ${treeId} and node_id = ${sourceSeatId}
      `;
        await insertChangeLog(tx, {
          treeId,
          actor,
          op: "delete_seat",
          nodeId: sourceSeatId,
          before: {
            parent_node_id: source.parent_node_id,
            job_title: sourceMeta[0]?.job_title ?? null,
            members: members.map((m) => m.employee_auth_id),
            sort_order: source.sort_order,
          },
          after: { reparented: sourceChildren.map((c) => c.node_id) },
          command,
        });

        for (const member of members) {
          await tx`select organelle.refresh_primary(${treeId}, ${member.employee_auth_id}, ${actor})`;
        }
        await tx`select organelle.validate_tree(${treeId})`;
        committed = await ackTouched(
          tx,
          treeId,
          [targetSeatId, ...order],
          command.commandId,
        );
      });
      return committed ?? rejected ?? { ok: false, reason: "Unknown failure" };
    },
    {
      logger: "sandbox.actions",
      operation: "join_peer",
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        tree_id: treeId,
        node_id: sourceSeatId,
        target_node_id: targetSeatId,
        expected_row_version: Number(expectedRowVersion),
      },
    },
  );
  logSandboxActionOutcome({
    operation: "join_peer",
    eventName: "sandbox.peer_join.result",
    result,
    startedAt,
    actorAuthId: actor,
    actorRole: access.actor.role,
    treeId,
    nodeId: sourceSeatId,
    fields: {
      target_node_id: targetSeatId,
      expected_row_version: Number(expectedRowVersion),
    },
  });
  return result;
}
