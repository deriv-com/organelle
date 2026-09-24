"use server";

import { withDbRetry } from "@/lib/db";
import { logStart } from "@/lib/app-logging";
import { LEAF_GRID_MAX, LEAF_GRID_MIN } from "@/features/chart/grid-org-chart";
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
import { rejectAssistantParent, type NodeRow } from "./structure";

export async function setAssistant(args: {
  treeId: string;
  nodeId: string;
  isAssistant: boolean;
  expectedRowVersion: number;
}): Promise<ActionResult> {
  const startedAt = logStart();
  const { treeId, nodeId, isAssistant, expectedRowVersion } = args;
  if (![treeId, nodeId].every((id) => UUID_RE.test(id))) {
    logSandboxActionRejection({
      operation: "set_assistant",
      eventName: "sandbox.assistant.result",
      failureReason: "Malformed id",
      startedAt,
      fields: { validation_target: "tree_id,node_id" },
    });
    return { ok: false, reason: "Malformed id" };
  }
  const expected = Number(expectedRowVersion);
  if (!Number.isSafeInteger(expected) || expected < 1) {
    logSandboxActionRejection({
      operation: "set_assistant",
      eventName: "sandbox.assistant.result",
      failureReason: "Bad version",
      startedAt,
      treeId,
      nodeId,
      fields: {
        expected_row_version: expectedRowVersion,
        is_assistant: isAssistant,
      },
    });
    return { ok: false, reason: "Bad version" };
  }
  const access = await requireActor();
  if (!access.ok) {
    logSandboxActionRejection({
      operation: "set_assistant",
      eventName: "sandbox.assistant.result",
      failureReason: "Not allowed",
      startedAt,
      treeId,
      nodeId,
      fields: {
        auth_status: access.status,
        expected_row_version: expected,
        is_assistant: isAssistant,
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
        const [node] = (await tx`
        select node_id, parent_node_id, node_type, row_version, is_assistant
        from organelle.nodes
        where tree_id = ${treeId} and node_id = ${nodeId}
        for update
      `) as unknown as (NodeRow & { is_assistant: boolean })[];
        if (!node) {
          rejected = { ok: false, reason: "Node no longer exists — reload" };
          return;
        }
        if (Number(node.row_version) !== expected) {
          rejected = { ok: false, reason: "Someone else moved this — reload" };
          return;
        }
        if (node.node_type !== "seat" || node.parent_node_id === null) {
          rejected = { ok: false, reason: "Can't make the root an assistant" };
          return;
        }
        if (isAssistant) {
          const blocked = await rejectAssistantParent(
            tx,
            treeId,
            node.parent_node_id,
            nodeId,
          );
          if (blocked) {
            rejected = blocked;
            return;
          }
          const kids = (await tx`
          select count(*)::int as n from organelle.nodes
          where tree_id = ${treeId} and parent_node_id = ${nodeId}
        `) as unknown as { n: number }[];
          if ((kids[0]?.n ?? 0) > 0) {
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
        }
        if (Boolean(node.is_assistant) === isAssistant) {
          committed = await ackTouched(tx, treeId, [nodeId], null);
          return;
        }
        await tx`
        update organelle.nodes set is_assistant = ${isAssistant}
        where tree_id = ${treeId} and node_id = ${nodeId}
      `;
        await insertChangeLog(tx, {
          treeId,
          actor,
          op: "set_assistant",
          nodeId,
          before: { is_assistant: Boolean(node.is_assistant) },
          after: { is_assistant: isAssistant },
          command,
        });
        await tx`select organelle.validate_tree(${treeId})`;
        committed = await ackTouched(tx, treeId, [nodeId], command.commandId);
      });
      return committed ?? rejected ?? { ok: false, reason: "Unknown failure" };
    },
    {
      logger: "sandbox.actions",
      operation: "set_assistant",
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        tree_id: treeId,
        node_id: nodeId,
        expected_row_version: expected,
        is_assistant: isAssistant,
      },
    },
  );
  logSandboxActionOutcome({
    operation: "set_assistant",
    eventName: "sandbox.assistant.result",
    result,
    startedAt,
    actorAuthId: actor,
    actorRole: access.actor.role,
    treeId,
    nodeId,
    fields: {
      expected_row_version: expected,
      is_assistant: isAssistant,
    },
  });
  return result;
}

export async function setLeafGridColumns(args: {
  treeId: string;
  nodeId: string;
  leafGridColumns: number;
  expectedRowVersion: number;
}): Promise<ActionResult> {
  const startedAt = logStart();
  const { treeId, nodeId, leafGridColumns, expectedRowVersion } = args;
  if (![treeId, nodeId].every((id) => UUID_RE.test(id))) {
    logSandboxActionRejection({
      operation: "set_leaf_grid_columns",
      eventName: "sandbox.leaf_grid_columns.result",
      failureReason: "Malformed id",
      startedAt,
      fields: { validation_target: "tree_id,node_id" },
    });
    return { ok: false, reason: "Malformed id" };
  }
  const columns = Math.min(
    LEAF_GRID_MAX,
    Math.max(LEAF_GRID_MIN, Math.trunc(leafGridColumns)),
  );
  const expected = Number(expectedRowVersion);
  if (!Number.isSafeInteger(expected) || expected < 1) {
    logSandboxActionRejection({
      operation: "set_leaf_grid_columns",
      eventName: "sandbox.leaf_grid_columns.result",
      failureReason: "Bad version",
      startedAt,
      treeId,
      nodeId,
      fields: {
        expected_row_version: expectedRowVersion,
        leaf_grid_columns: columns,
      },
    });
    return { ok: false, reason: "Bad version" };
  }
  const access = await requireActor();
  if (!access.ok) {
    logSandboxActionRejection({
      operation: "set_leaf_grid_columns",
      eventName: "sandbox.leaf_grid_columns.result",
      failureReason: "Not allowed",
      startedAt,
      treeId,
      nodeId,
      fields: {
        auth_status: access.status,
        expected_row_version: expected,
        leaf_grid_columns: columns,
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
        const [node] = (await tx`
        select node_id, row_version, leaf_grid_columns
        from organelle.nodes
        where tree_id = ${treeId} and node_id = ${nodeId}
        for update
      `) as unknown as {
          node_id: string;
          row_version: number;
          leaf_grid_columns: number;
        }[];
        if (!node) {
          rejected = { ok: false, reason: "Node no longer exists — reload" };
          return;
        }
        if (Number(node.row_version) !== expected) {
          rejected = { ok: false, reason: "Someone else moved this — reload" };
          return;
        }
        if (Number(node.leaf_grid_columns) === columns) {
          committed = await ackTouched(tx, treeId, [nodeId], null);
          return;
        }
        await tx`
        update organelle.nodes set leaf_grid_columns = ${columns}
        where tree_id = ${treeId} and node_id = ${nodeId}
      `;
        await insertChangeLog(tx, {
          treeId,
          actor,
          op: "set_leaf_grid_columns",
          nodeId,
          before: { leaf_grid_columns: Number(node.leaf_grid_columns) },
          after: { leaf_grid_columns: columns },
          command,
        });
        await tx`select organelle.validate_tree(${treeId})`;
        committed = await ackTouched(tx, treeId, [nodeId], command.commandId);
      });
      return committed ?? rejected ?? { ok: false, reason: "Unknown failure" };
    },
    {
      logger: "sandbox.actions",
      operation: "set_leaf_grid_columns",
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        tree_id: treeId,
        node_id: nodeId,
        expected_row_version: expected,
        leaf_grid_columns: columns,
      },
    },
  );
  logSandboxActionOutcome({
    operation: "set_leaf_grid_columns",
    eventName: "sandbox.leaf_grid_columns.result",
    result,
    startedAt,
    actorAuthId: actor,
    actorRole: access.actor.role,
    treeId,
    nodeId,
    fields: {
      expected_row_version: expected,
      leaf_grid_columns: columns,
    },
  });
  return result;
}
