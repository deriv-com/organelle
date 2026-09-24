"use server";

import { stageEmployeeEdit, employeeEdit } from "../staged-employees";

import type { TransactionSql } from "postgres";

import { withDbRetry } from "@/lib/db";
import { logStart } from "@/lib/app-logging";
import { requireActor } from "@/features/auth/session";
import {
  isValidReactivationDate,
  localEmployeeInsert,
  resolveSeatTitle,
  validateCreatePerson,
} from "@/features/directory/employee-fields";
import {
  deleteDraftEmployeeIfOrphaned,
  draftSnapshotFromInsert,
  loadDraftSnapshots,
} from "../draft-employees";
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
  type CreateNodeArgs,
} from "./shared";

/** Context-menu add: a header needs a name, a seat needs an
 *  employee (never created vacant — the employee becomes host). */
export async function createNode(args: CreateNodeArgs): Promise<ActionResult> {
  const startedAt = logStart();
  const { treeId, parentId, kind } = args;
  if (!UUID_RE.test(treeId) || !UUID_RE.test(parentId)) {
    logSandboxActionRejection({
      operation: "create_node",
      eventName: "sandbox.node_create.result",
      failureReason: "Malformed id",
      startedAt,
      fields: {
        validation_target: "tree_id,parent_node_id",
        node_type: kind,
      },
    });
    return { ok: false, reason: "Malformed id" };
  }
  if (args.nodeId !== undefined && !UUID_RE.test(args.nodeId)) {
    logSandboxActionRejection({
      operation: "create_node",
      eventName: "sandbox.node_create.result",
      failureReason: "Malformed id",
      startedAt,
      treeId,
      fields: {
        parent_node_id: parentId,
        validation_target: "node_id",
        node_type: kind,
      },
    });
    return { ok: false, reason: "Malformed id" };
  }
  const name = kind === "header" ? args.name.trim() : null;
  if (kind === "header" && (!name || name.length > 120)) {
    logSandboxActionRejection({
      operation: "create_node",
      eventName: "sandbox.node_create.result",
      failureReason: "Team name must be 1–120 characters",
      startedAt,
      treeId,
      fields: {
        parent_node_id: parentId,
        node_type: kind,
        name_length: name?.length ?? 0,
      },
    });
    return { ok: false, reason: "Team name must be 1–120 characters" };
  }
  const creatingPerson = kind === "seat" && args.newPerson != null;
  if (kind === "seat" && !creatingPerson && !UUID_RE.test(args.employeeAuthId ?? "")) {
    logSandboxActionRejection({
      operation: "create_node",
      eventName: "sandbox.node_create.result",
      failureReason: "Unknown employee",
      startedAt,
      treeId,
      fields: {
        parent_node_id: parentId,
        node_type: kind,
        validation_target: "employee_auth_id",
      },
    });
    return { ok: false, reason: "Unknown employee" };
  }
  if (kind === "seat" && creatingPerson) {
    const personErrors = validateCreatePerson(args.newPerson!, args.jobTitle);
    if (Object.keys(personErrors).length > 0) {
      const reason = Object.values(personErrors)[0] ?? "Invalid person";
      logSandboxActionRejection({
        operation: "create_node",
        eventName: "sandbox.node_create.result",
        failureReason: reason,
        startedAt,
        treeId,
        fields: {
          parent_node_id: parentId,
          node_type: kind,
          validation_target: "new_person",
        },
      });
      return { ok: false, reason };
    }
    if (args.newPersonAuthId !== undefined && !UUID_RE.test(args.newPersonAuthId)) {
      logSandboxActionRejection({
        operation: "create_node",
        eventName: "sandbox.node_create.result",
        failureReason: "Malformed id",
        startedAt,
        treeId,
        fields: {
          parent_node_id: parentId,
          validation_target: "new_person_auth_id",
          node_type: kind,
        },
      });
      return { ok: false, reason: "Malformed id" };
    }
  }
  const jobTitle =
    kind === "seat"
      ? creatingPerson
        ? resolveSeatTitle(args.jobTitle, args.newPerson!.jobTitle)
        : args.jobTitle.trim()
      : null;
  if (kind === "seat" && (!jobTitle || jobTitle.length > 120)) {
    logSandboxActionRejection({
      operation: "create_node",
      eventName: "sandbox.node_create.result",
      failureReason: "Job title must be 1–120 characters",
      startedAt,
      treeId,
      fields: {
        parent_node_id: parentId,
        node_type: kind,
        job_title_length: jobTitle?.length ?? 0,
      },
    });
    return { ok: false, reason: "Job title must be 1–120 characters" };
  }
  const access = await requireActor();
  if (!access.ok) {
    logSandboxActionRejection({
      operation: "create_node",
      eventName: "sandbox.node_create.result",
      failureReason: "Not allowed",
      startedAt,
      treeId,
      fields: {
        auth_status: access.status,
        parent_node_id: parentId,
        node_type: kind,
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
        const parents = (await tx`
        select node_id from organelle.nodes
        where tree_id = ${treeId} and node_id = ${parentId}
        for update
      `) as unknown as { node_id: string }[];
        if (parents.length !== 1) {
          rejected = { ok: false, reason: "Parent no longer exists — reload" };
          return;
        }
        const asAssistant = kind === "seat" && args.isAssistant === true;
        if (asAssistant) {
          const blocked = await rejectAssistantParent(tx, treeId, parentId);
          if (blocked) {
            rejected = blocked;
            return;
          }
        }

        // Depth pre-check (walks parent_node_id): the new node would sit one
        // level below the parent. validate_tree remains the final assertion.
        const [depthRow] = (await tx`
        with recursive walk as (
          select n.node_id, n.parent_node_id, 1 as depth, array[n.node_id] as seen
            from organelle.nodes n
           where n.tree_id = ${treeId} and n.node_id = ${parentId}
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

        const [maxSort] = (await tx`
        select coalesce(max(sort_order) + 1, 0)::int as next
        from organelle.nodes
        where tree_id = ${treeId} and parent_node_id = ${parentId}
      `) as unknown as { next: number }[];

        // A seat is never created vacant: resolve the employee first.
        // Job title is the seat's own title (submitted), not employees.job_title.
        let employee: { auth_id: string } | null = null;
        let draftEmployeeSnap: ReturnType<typeof draftSnapshotFromInsert> | null = null;
        if (kind === "seat" && creatingPerson) {
          const row = localEmployeeInsert(
            args.newPerson!,
            args.newPersonAuthId ?? crypto.randomUUID(),
          );
          draftEmployeeSnap = draftSnapshotFromInsert(row);
          if (row.email != null) {
            const taken = (await tx`
            select auth_id from organelle.employees
            where lower(email) = lower(${row.email})
            limit 1
          `) as unknown as { auth_id: string }[];
            if (taken.length > 0) {
              rejected = { ok: false, reason: "That email is already in use" };
              return;
            }
          }
          try {
            await tx`
            insert into organelle.employees (
              auth_id, email, full_name, legal_full_name, id, employment_record,
              job_title, position_level, avatar_url, office_country, office_location,
              hiring_company, status, joining_date, hired_at, resignation_date,
              last_working_date, sandbox_tree_id
            ) values (
              ${row.auth_id}, ${row.email}, ${row.full_name}, ${row.legal_full_name},
              ${row.id}, ${row.employment_record}, ${row.job_title}, ${row.position_level},
              ${row.avatar_url}, ${row.office_country}, ${row.office_location}, ${row.hiring_company},
              ${row.status}, ${row.joining_date}, ${row.hired_at}, ${row.resignation_date},
              ${row.last_working_date}, ${treeId}
            )
          `;
          } catch {
            rejected = { ok: false, reason: "That email is already in use" };
            return;
          }
          employee = { auth_id: row.auth_id };
        } else if (kind === "seat") {
          const existingAuthId = args.employeeAuthId ?? "";
          const found = (await tx`
          select auth_id, status::text as status, joining_date::text as joining_date,
                 last_working_date::text as last_working_date
          from organelle.employees
          where auth_id = ${existingAuthId}
            and (sandbox_tree_id is null or sandbox_tree_id = ${treeId})
          for update
        `) as unknown as {
            auth_id: string;
            status: "joining" | "active" | "serving_notice" | "inactive" | "resigned";
            joining_date: string | null;
            last_working_date: string | null;
          }[];
          employee = found[0] ?? null;
          if (!employee) {
            rejected = { ok: false, reason: "Unknown employee" };
            return;
          }
          const person = found[0]!;
          const edits = await tx<
            { after_data: Record<string, unknown> }[]
          >`select after_data from organelle.sandbox_employee_edits where tree_id = ${treeId} and employee_auth_id = ${person.auth_id}`;
          Object.assign(person, edits[0]?.after_data ?? {});
          if (person.status === "inactive" || person.status === "resigned") {
            const joiningDate = args.reactivateWithJoiningDate?.trim() ?? "";
            if (!isValidReactivationDate(joiningDate)) {
              rejected = {
                ok: false,
                reason: "Set a valid joining date to reactivate this employee",
              };
              return;
            }
            const reactivated = (
              await tx<
                { status: "joining" | "active" }[]
              >`select case when ${joiningDate}::date <= current_date then 'active' else 'joining' end as status`
            )[0]!;
            await stageEmployeeEdit(
              tx,
              treeId,
              person.auth_id,
              employeeEdit(person, {
                status: reactivated.status,
                joining_date: joiningDate,
                last_working_date: null,
              }),
            );
            await insertChangeLog(tx, {
              treeId,
              actor,
              op: "update_employee",
              employeeAuthId: person.auth_id,
              before: {
                status: person.status,
                joining_date: person.joining_date,
                last_working_date: person.last_working_date,
              },
              after: {
                status: reactivated.status,
                joining_date: joiningDate,
                last_working_date: null,
              },
              command: null,
            });
          }
        }

        const inserted = (await tx`
        insert into organelle.nodes
          (tree_id, node_id, parent_node_id, node_type, sort_order, name, job_title, is_assistant)
        values (
          ${treeId},
          ${args.nodeId ?? crypto.randomUUID()},
          ${parentId}, ${kind}, ${maxSort!.next},
          ${kind === "header" ? name : null},
          ${kind === "seat" ? jobTitle : null},
          ${asAssistant}
        )
        returning node_id
      `) as unknown as { node_id: string }[];
        const nodeId = inserted[0]!.node_id;

        if (kind === "seat") {
          const [existing] = (await tx`
          select count(*)::int as n
          from organelle.seat_assignments
          where tree_id = ${treeId} and employee_auth_id = ${employee!.auth_id}
        `) as unknown as { n: number }[];
          const isPrimary = (existing?.n ?? 0) === 0;
          await tx`
          insert into organelle.seat_assignments
            (tree_id, node_id, employee_auth_id, is_host, is_primary)
          values (${treeId}, ${nodeId}, ${employee!.auth_id}, true, ${isPrimary})
        `;
          await tx`select organelle.refresh_primary(${treeId}, ${employee!.auth_id}, ${actor})`;
        }

        await insertChangeLog(tx, {
          treeId,
          actor,
          op: kind === "header" ? "create_header" : "create_seat",
          nodeId,
          employeeAuthId: kind === "seat" ? employee!.auth_id : null,
          after:
            kind === "header"
              ? { parent_node_id: parentId, name, sort_order: maxSort!.next }
              : {
                  parent_node_id: parentId,
                  job_title: jobTitle,
                  sort_order: maxSort!.next,
                  ...(asAssistant ? { is_assistant: true } : {}),
                  ...(draftEmployeeSnap ? { draft_employee: draftEmployeeSnap } : {}),
                },
          command,
        });

        await tx`select organelle.validate_tree(${treeId})`;
        committed = await ackTouched(tx, treeId, [nodeId], command.commandId);
      });
      return committed ?? rejected ?? { ok: false, reason: "Unknown failure" };
    },
    {
      logger: "sandbox.actions",
      operation: "create_node",
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        tree_id: treeId,
        parent_node_id: parentId,
        node_type: kind,
      },
    },
  );
  logSandboxActionOutcome({
    operation: "create_node",
    eventName: "sandbox.node_create.result",
    result,
    startedAt,
    actorAuthId: actor,
    actorRole: access.actor.role,
    treeId,
    nodeId: result.ok ? result.versions[0]?.nodeId : args.nodeId,
    fields: {
      parent_node_id: parentId,
      node_type: kind,
      is_assistant: kind === "seat" ? args.isAssistant === true : undefined,
    },
  });
  return result;
}

export interface NodeRow {
  node_id: string;
  parent_node_id: string | null;
  node_type: "header" | "seat";
  sort_order: number;
  row_version: number;
}

export async function rejectAssistantParent(
  tx: TransactionSql,
  treeId: string,
  parentId: string,
  exceptId?: string,
): Promise<ActionErr | null> {
  const [parent] = (await tx`
    select node_type from organelle.nodes
    where tree_id = ${treeId} and node_id = ${parentId}
  `) as unknown as { node_type: "header" | "seat" }[];
  if (!parent) return { ok: false, reason: "Node no longer exists — reload" };
  if (parent.node_type !== "seat") {
    return { ok: false, reason: "Assistants only under a person" };
  }
  const taken = exceptId
    ? ((await tx`
        select node_id from organelle.nodes
        where tree_id = ${treeId} and parent_node_id = ${parentId} and is_assistant
          and node_id <> ${exceptId}
        limit 1
      `) as unknown as { node_id: string }[])
    : ((await tx`
        select node_id from organelle.nodes
        where tree_id = ${treeId} and parent_node_id = ${parentId} and is_assistant
        limit 1
      `) as unknown as { node_id: string }[]);
  if (taken.length > 0) return { ok: false, reason: "Already has an assistant" };
  return null;
}

/** True when `maybeDescendant` sits inside `ancestorId`'s subtree (walks
 *  parent_node_id, never path). */
export async function isInSubtree(
  tx: TransactionSql,
  treeId: string,
  ancestorId: string,
  maybeDescendant: string,
): Promise<boolean> {
  const rows = (await tx`
    with recursive walk as (
      select n.node_id, n.parent_node_id, 1 as depth, array[n.node_id] as seen
        from organelle.nodes n
       where n.tree_id = ${treeId} and n.node_id = ${maybeDescendant}
      union all
      select p.node_id, p.parent_node_id, w.depth + 1, w.seen || p.node_id
        from organelle.nodes p
        join walk w on p.node_id = w.parent_node_id
       where p.tree_id = ${treeId}
         and p.node_id <> all (w.seen)
         and w.depth <= 32
    )
    select count(*)::int as hits from walk where node_id = ${ancestorId}
  `) as { hits: number }[];
  return (rows[0]?.hits ?? 0) > 0;
}

/** Resequence a sibling set to 0..n following `orderedIds`. */
export async function resequenceSiblings(
  tx: TransactionSql,
  treeId: string,
  orderedIds: string[],
): Promise<void> {
  if (orderedIds.length === 0) return;
  await tx`
    update organelle.nodes n
       set sort_order = v.ord - 1
      from unnest(${orderedIds}::uuid[]) with ordinality as v(node_id, ord)
     where n.tree_id = ${treeId}
       and n.node_id = v.node_id
       and n.sort_order <> v.ord - 1
  `;
}

export async function moveNode(args: {
  treeId: string;
  nodeId: string;
  newParentId: string;
  beforeSiblingId: string | null;
  expectedRowVersion: number;
  /** "subtree" (default): the whole subtree comes along. "node-only": the
   *  node moves alone; its children detach to the node's old parent at its
   *  former position. */
  mode?: "subtree" | "node-only";
  asAssistant?: boolean;
}): Promise<ActionResult> {
  const startedAt = logStart();
  const {
    treeId,
    nodeId,
    newParentId,
    beforeSiblingId,
    expectedRowVersion,
    mode = "subtree",
    asAssistant = false,
  } = args;
  if (![treeId, nodeId, newParentId].every((id) => UUID_RE.test(id))) {
    logSandboxActionRejection({
      operation: "move_node",
      eventName: "sandbox.node_move.result",
      failureReason: "Malformed id",
      startedAt,
      fields: {
        validation_target: "tree_id,node_id,parent_node_id",
        move_mode: mode,
        is_assistant: asAssistant,
      },
    });
    return { ok: false, reason: "Malformed id" };
  }
  if (beforeSiblingId !== null && !UUID_RE.test(beforeSiblingId)) {
    logSandboxActionRejection({
      operation: "move_node",
      eventName: "sandbox.node_move.result",
      failureReason: "Malformed id",
      startedAt,
      treeId,
      nodeId,
      fields: {
        parent_node_id: newParentId,
        validation_target: "before_sibling_id",
        move_mode: mode,
        is_assistant: asAssistant,
      },
    });
    return { ok: false, reason: "Malformed id" };
  }
  // row_version is bigint: postgres.js may deliver it as string/BigInt.
  const expected = Number(expectedRowVersion);
  if (!Number.isSafeInteger(expected) || expected < 1) {
    logSandboxActionRejection({
      operation: "move_node",
      eventName: "sandbox.node_move.result",
      failureReason: "Bad version",
      startedAt,
      treeId,
      nodeId,
      fields: {
        parent_node_id: newParentId,
        expected_row_version: expectedRowVersion,
        move_mode: mode,
        is_assistant: asAssistant,
      },
    });
    return { ok: false, reason: "Bad version" };
  }
  const access = await requireActor();
  if (!access.ok) {
    logSandboxActionRejection({
      operation: "move_node",
      eventName: "sandbox.node_move.result",
      failureReason: "Not allowed",
      startedAt,
      treeId,
      nodeId,
      fields: {
        auth_status: access.status,
        parent_node_id: newParentId,
        expected_row_version: expected,
        move_mode: mode,
        is_assistant: asAssistant,
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
        where tree_id = ${treeId} and node_id in (${nodeId}, ${newParentId})
        for update
      `) as unknown as (NodeRow & { is_assistant: boolean })[];
        const node = nodes.find((n) => n.node_id === nodeId);
        const parent = nodes.find((n) => n.node_id === newParentId);
        if (!node || !parent) {
          rejected = { ok: false, reason: "Node no longer exists — reload" };
          return;
        }
        if (node.parent_node_id === null) {
          rejected = { ok: false, reason: "Can't move the root" };
          return;
        }
        if (nodeId === newParentId) {
          rejected = { ok: false, reason: "Can't drop a node onto itself" };
          return;
        }
        if (Number(node.row_version) !== expected) {
          rejected = { ok: false, reason: "Someone else moved this — reload" };
          return;
        }
        if (await isInSubtree(tx, treeId, nodeId, newParentId)) {
          rejected = { ok: false, reason: "Can't move a node into its own team" };
          return;
        }

        const oldParentId = node.parent_node_id;

        // Node-only: detach the children to the old parent, spliced in at the
        // node's former position (same splice rule as delete's reparent). Runs
        // before the move so the new-parent sibling list already reflects the
        // detach when old and new parents coincide.
        const detached: { nodeId: string; oldSort: number; newSort: number }[] = [];
        if (mode === "node-only") {
          const children = (await tx`
          select node_id, is_assistant from organelle.nodes
          where tree_id = ${treeId} and parent_node_id = ${nodeId}
          order by sort_order
        `) as unknown as { node_id: string; is_assistant: boolean }[];
          const childIds = children.map((child) => child.node_id);
          const leftoverAssistants = children
            .filter((child) => child.is_assistant)
            .map((c) => c.node_id);

          if (leftoverAssistants.length > 0 && oldParentId) {
            const [dest] = (await tx`
            select node_type from organelle.nodes
            where tree_id = ${treeId} and node_id = ${oldParentId}
          `) as unknown as { node_type: "header" | "seat" }[];
            if (dest?.node_type === "seat") {
              const clash = await rejectAssistantParent(
                tx,
                treeId,
                oldParentId,
                nodeId,
              );
              if (clash) {
                rejected = clash;
                return;
              }
            }
          }

          if (childIds.length > 0) {
            const oldSiblings = (await tx`
            select node_id from organelle.nodes
            where tree_id = ${treeId} and parent_node_id = ${oldParentId} and node_id <> ${nodeId}
            order by sort_order
          `) as unknown as { node_id: string }[];
            const oldOrder = oldSiblings.map((sibling) => sibling.node_id);
            const insertAt = Math.min(node.sort_order, oldOrder.length);
            oldOrder.splice(insertAt, 0, ...childIds);

            await tx`
            update organelle.nodes set parent_node_id = ${oldParentId}
            where tree_id = ${treeId} and parent_node_id = ${nodeId}
          `;
            await resequenceSiblings(tx, treeId, oldOrder);
            childIds.forEach((childId, index) =>
              detached.push({
                nodeId: childId,
                oldSort: index,
                newSort: insertAt + index,
              }),
            );
            const [dest] = (await tx`
            select node_type from organelle.nodes
            where tree_id = ${treeId} and node_id = ${oldParentId}
          `) as unknown as { node_type: "header" | "seat" }[];
            if (dest?.node_type === "header" && leftoverAssistants.length > 0) {
              await tx`
              update organelle.nodes set is_assistant = false
              where tree_id = ${treeId} and node_id = any(${leftoverAssistants}::uuid[])
            `;
            }
          }
        }

        const siblings = (await tx`
        select node_id from organelle.nodes
        where tree_id = ${treeId} and parent_node_id = ${newParentId} and node_id <> ${nodeId}
        order by sort_order
      `) as unknown as { node_id: string }[];
        const order = siblings.map((s) => s.node_id);
        const insertAt =
          beforeSiblingId && order.includes(beforeSiblingId)
            ? order.indexOf(beforeSiblingId)
            : order.length;
        order.splice(insertAt, 0, nodeId);

        if (asAssistant) {
          const blocked = await rejectAssistantParent(tx, treeId, newParentId, nodeId);
          if (blocked) {
            rejected = blocked;
            return;
          }
          const remainingKids = (await tx`
          select count(*)::int as n from organelle.nodes
          where tree_id = ${treeId} and parent_node_id = ${nodeId}
        `) as unknown as { n: number }[];
          if ((remainingKids[0]?.n ?? 0) > 0) {
            rejected = { ok: false, reason: "Can't make a manager an assistant" };
            return;
          }
          const [members] = (await tx`
          select count(*)::int as n from organelle.seat_assignments
          where tree_id = ${treeId} and node_id = ${nodeId}
        `) as unknown as { n: number }[];
          if ((members?.n ?? 0) !== 1) {
            rejected = { ok: false, reason: "Assistant must be one person" };
            return;
          }
          if (node.node_type !== "seat" || parent.node_type !== "seat") {
            rejected = { ok: false, reason: "Assistants only under a person" };
            return;
          }
        }

        await tx`
        update organelle.nodes
        set parent_node_id = ${newParentId}, sort_order = ${insertAt}, is_assistant = ${asAssistant}
        where tree_id = ${treeId} and node_id = ${nodeId}
      `;
        await resequenceSiblings(tx, treeId, order);
        const oldSiblingIds: string[] = [];
        if (oldParentId !== newParentId) {
          const oldSiblings = (await tx`
          select node_id from organelle.nodes
          where tree_id = ${treeId} and parent_node_id = ${oldParentId}
          order by sort_order
        `) as unknown as { node_id: string }[];
          oldSiblingIds.push(...oldSiblings.map((s) => s.node_id));
          await resequenceSiblings(tx, treeId, oldSiblingIds);
        }

        // One replayable row per detached child (their parent changed), then the
        // dragged node's own row — same order as the writes above.
        for (const child of detached) {
          await insertChangeLog(tx, {
            treeId,
            actor,
            op: "move_node",
            nodeId: child.nodeId,
            before: { parent_node_id: nodeId, sort_order: child.oldSort },
            after: { parent_node_id: oldParentId, sort_order: child.newSort },
            command,
          });
        }
        const op = oldParentId === newParentId ? "reorder_node" : "move_node";
        await insertChangeLog(tx, {
          treeId,
          actor,
          op,
          nodeId,
          before: {
            parent_node_id: oldParentId,
            sort_order: node.sort_order,
            is_assistant: Boolean(node.is_assistant),
          },
          after: {
            parent_node_id: newParentId,
            sort_order: insertAt,
            is_assistant: asAssistant,
          },
          command,
        });

        await tx`select organelle.validate_tree(${treeId})`;
        committed = await ackTouched(
          tx,
          treeId,
          [
            nodeId,
            ...order,
            ...oldSiblingIds,
            ...detached.map((child) => child.nodeId),
          ],
          command.commandId,
        );
      });
      return committed ?? rejected ?? { ok: false, reason: "Unknown failure" };
    },
    {
      logger: "sandbox.actions",
      operation: "move_node",
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        tree_id: treeId,
        node_id: nodeId,
        parent_node_id: newParentId,
        expected_row_version: expected,
        move_mode: mode,
        is_assistant: asAssistant,
      },
    },
  );
  logSandboxActionOutcome({
    operation: "move_node",
    eventName: "sandbox.node_move.result",
    result,
    startedAt,
    actorAuthId: actor,
    actorRole: access.actor.role,
    treeId,
    nodeId,
    fields: {
      parent_node_id: newParentId,
      expected_row_version: expected,
      move_mode: mode,
      is_assistant: asAssistant,
    },
  });
  return result;
}

/** Delete with reparent-to-grandparent: the
 *  node's children are spliced into its parent's sibling list at the deleted
 *  node's former position; a seat's members lose that seat. Root rejected. */
export async function deleteNode(args: {
  treeId: string;
  nodeId: string;
  expectedRowVersion: number;
}): Promise<ActionResult> {
  const startedAt = logStart();
  const { treeId, nodeId, expectedRowVersion } = args;
  if (!UUID_RE.test(treeId) || !UUID_RE.test(nodeId)) {
    logSandboxActionRejection({
      operation: "delete_node",
      eventName: "sandbox.node_delete.result",
      failureReason: "Malformed id",
      startedAt,
      fields: { validation_target: "tree_id,node_id" },
    });
    return { ok: false, reason: "Malformed id" };
  }
  const expected = Number(expectedRowVersion);
  if (!Number.isSafeInteger(expected) || expected < 1) {
    logSandboxActionRejection({
      operation: "delete_node",
      eventName: "sandbox.node_delete.result",
      failureReason: "Bad version",
      startedAt,
      treeId,
      nodeId,
      fields: { expected_row_version: expectedRowVersion },
    });
    return { ok: false, reason: "Bad version" };
  }
  const access = await requireActor();
  if (!access.ok) {
    logSandboxActionRejection({
      operation: "delete_node",
      eventName: "sandbox.node_delete.result",
      failureReason: "Not allowed",
      startedAt,
      treeId,
      nodeId,
      fields: {
        auth_status: access.status,
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
        select node_id, parent_node_id, node_type, sort_order, row_version, name, job_title
        from organelle.nodes
        where tree_id = ${treeId} and node_id = ${nodeId}
        for update
      `) as unknown as (NodeRow & { name: string | null; job_title: string | null })[];
        const node = nodes[0];
        if (!node) {
          rejected = { ok: false, reason: "Node no longer exists — reload" };
          return;
        }
        if (node.parent_node_id === null) {
          rejected = { ok: false, reason: "Can't delete the root" };
          return;
        }
        if (Number(node.row_version) !== expected) {
          rejected = { ok: false, reason: "Someone else moved this — reload" };
          return;
        }
        const grandparentId = node.parent_node_id;

        const children = (await tx`
        select node_id from organelle.nodes
        where tree_id = ${treeId} and parent_node_id = ${nodeId}
        order by sort_order
      `) as unknown as { node_id: string }[];
        const childIds = children.map((child) => child.node_id);

        const members = (await tx`
        select employee_auth_id from organelle.seat_assignments
        where tree_id = ${treeId} and node_id = ${nodeId}
        order by is_host desc nulls last, assigned_at
      `) as unknown as { employee_auth_id: string }[];
        const memberIds = members.map((member) => member.employee_auth_id);
        const draftEmployees = await loadDraftSnapshots(tx, treeId, memberIds);

        const siblings = (await tx`
        select node_id from organelle.nodes
        where tree_id = ${treeId} and parent_node_id = ${grandparentId} and node_id <> ${nodeId}
        order by sort_order
      `) as unknown as { node_id: string }[];
        const order = siblings.map((sibling) => sibling.node_id);
        const insertAt = Math.min(node.sort_order, order.length);
        order.splice(insertAt, 0, ...childIds);

        if (childIds.length > 0) {
          await tx`
          update organelle.nodes set parent_node_id = ${grandparentId}
          where tree_id = ${treeId} and parent_node_id = ${nodeId}
        `;
          const [dest] = (await tx`
          select node_type from organelle.nodes
          where tree_id = ${treeId} and node_id = ${grandparentId}
        `) as unknown as { node_type: "header" | "seat" }[];
          const [existing] = (await tx`
          select node_id from organelle.nodes
          where tree_id = ${treeId} and parent_node_id = ${grandparentId}
            and is_assistant and node_id <> all(${childIds}::uuid[])
          limit 1
        `) as unknown as { node_id: string }[];
          if (dest?.node_type === "header" || existing) {
            await tx`
            update organelle.nodes set is_assistant = false
            where tree_id = ${treeId}
              and node_id = any(${childIds}::uuid[])
              and is_assistant
          `;
          }
        }
        await tx`
        delete from organelle.seat_assignments
        where tree_id = ${treeId} and node_id = ${nodeId}
      `;
        await tx`
        delete from organelle.nodes
        where tree_id = ${treeId} and node_id = ${nodeId}
      `;
        for (const authId of memberIds) {
          await tx`select organelle.refresh_primary(${treeId}, ${authId}, ${actor})`;
          await deleteDraftEmployeeIfOrphaned(tx, treeId, authId);
        }
        await resequenceSiblings(tx, treeId, order);

        await insertChangeLog(tx, {
          treeId,
          actor,
          op: node.node_type === "header" ? "delete_header" : "delete_seat",
          nodeId,
          employeeAuthId: memberIds[0] ?? null,
          before:
            node.node_type === "header"
              ? {
                  parent_node_id: grandparentId,
                  name: node.name,
                  sort_order: node.sort_order,
                }
              : {
                  parent_node_id: grandparentId,
                  job_title: node.job_title,
                  members: memberIds,
                  sort_order: node.sort_order,
                  ...(Object.keys(draftEmployees).length > 0
                    ? { draft_employees: draftEmployees }
                    : {}),
                },
          after: { reparented: childIds },
          command,
        });

        await tx`select organelle.validate_tree(${treeId})`;
        committed = await ackTouched(tx, treeId, order, command.commandId);
      });
      return committed ?? rejected ?? { ok: false, reason: "Unknown failure" };
    },
    {
      logger: "sandbox.actions",
      operation: "delete_node",
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        tree_id: treeId,
        node_id: nodeId,
        expected_row_version: expected,
      },
    },
  );
  logSandboxActionOutcome({
    operation: "delete_node",
    eventName: "sandbox.node_delete.result",
    result,
    startedAt,
    actorAuthId: actor,
    actorRole: access.actor.role,
    treeId,
    nodeId,
    fields: {
      expected_row_version: expected,
    },
  });
  return result;
}

export async function renameHeader(args: {
  treeId: string;
  nodeId: string;
  name: string;
  expectedRowVersion: number;
}): Promise<ActionResult> {
  const startedAt = logStart();
  const { treeId, nodeId, expectedRowVersion } = args;
  const name = args.name.trim();
  if (!UUID_RE.test(treeId) || !UUID_RE.test(nodeId)) {
    logSandboxActionRejection({
      operation: "rename_header",
      eventName: "sandbox.header_rename.result",
      failureReason: "Malformed id",
      startedAt,
      fields: { validation_target: "tree_id,node_id" },
    });
    return { ok: false, reason: "Malformed id" };
  }
  if (!name || name.length > 120) {
    logSandboxActionRejection({
      operation: "rename_header",
      eventName: "sandbox.header_rename.result",
      failureReason: "Team name must be 1–120 characters",
      startedAt,
      treeId,
      nodeId,
      fields: { name_length: name.length },
    });
    return { ok: false, reason: "Team name must be 1–120 characters" };
  }
  const expected = Number(expectedRowVersion);
  if (!Number.isSafeInteger(expected) || expected < 1) {
    logSandboxActionRejection({
      operation: "rename_header",
      eventName: "sandbox.header_rename.result",
      failureReason: "Bad version",
      startedAt,
      treeId,
      nodeId,
      fields: { expected_row_version: expectedRowVersion },
    });
    return { ok: false, reason: "Bad version" };
  }
  const access = await requireActor();
  if (!access.ok) {
    logSandboxActionRejection({
      operation: "rename_header",
      eventName: "sandbox.header_rename.result",
      failureReason: "Not allowed",
      startedAt,
      treeId,
      nodeId,
      fields: {
        auth_status: access.status,
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
        select node_id, node_type, name, row_version
        from organelle.nodes
        where tree_id = ${treeId} and node_id = ${nodeId}
        for update
      `) as unknown as {
          node_id: string;
          node_type: string;
          name: string | null;
          row_version: number;
        }[];
        const node = nodes[0];
        if (!node) {
          rejected = { ok: false, reason: "Node no longer exists — reload" };
          return;
        }
        if (node.node_type !== "header") {
          rejected = { ok: false, reason: "Only teams can be renamed" };
          return;
        }
        if (Number(node.row_version) !== expected) {
          rejected = { ok: false, reason: "Someone else moved this — reload" };
          return;
        }
        if (node.name !== name) {
          await tx`
          update organelle.nodes set name = ${name}
          where tree_id = ${treeId} and node_id = ${nodeId}
        `;
          await insertChangeLog(tx, {
            treeId,
            actor,
            op: "rename_header",
            nodeId,
            before: { name: node.name },
            after: { name },
            command,
          });
        }
        committed = await ackTouched(tx, treeId, [nodeId], command.commandId);
      });
      return committed ?? rejected ?? { ok: false, reason: "Unknown failure" };
    },
    {
      logger: "sandbox.actions",
      operation: "rename_header",
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        tree_id: treeId,
        node_id: nodeId,
        expected_row_version: expected,
      },
    },
  );
  logSandboxActionOutcome({
    operation: "rename_header",
    eventName: "sandbox.header_rename.result",
    result,
    startedAt,
    actorAuthId: actor,
    actorRole: access.actor.role,
    treeId,
    nodeId,
    fields: {
      expected_row_version: expected,
    },
  });
  return result;
}
