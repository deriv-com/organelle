"use server";

import { withDbRetry } from "@/lib/db";
import { logStart } from "@/lib/app-logging";
import { EDITOR_ROLES, requireActor, requireRole } from "@/features/auth/session";
import { insertChangeLog } from "../change-log";
import {
  commandFocusNodeId,
  reconstructStacks,
  type CommandLogRow,
} from "../command-stack";
import { applyCommandSql } from "../command-sql";
import { inverseLogRows } from "../invert-command";
import { sandboxAccessWithSql } from "../access";
import { lockEditableSandbox, UUID_RE } from "../lock";
import { canReadSandboxHistory } from "../read-access";
import type { UndoChrome } from "../persist-ack";
import {
  ackTouched,
  loadCommandLog,
  loadCommandSummaries,
  logSandboxActionRejection,
  logSandboxActionOutcome,
  type ActionErr,
  type ActionOk,
  type ActionResult,
} from "./shared";

export type UndoState = UndoChrome & {
  undoCommandId: string | null;
  redoCommandId: string | null;
  undoLog: CommandLogRow[];
  redoLog: CommandLogRow[];
};

const EMPTY_UNDO_STATE: UndoState = {
  commandId: null,
  canUndo: false,
  canRedo: false,
  undoFocusNodeId: null,
  redoFocusNodeId: null,
  undoLog: [],
  redoLog: [],
  undoCommandId: null,
  redoCommandId: null,
};

export async function getUndoState(treeId: string): Promise<UndoState> {
  if (!UUID_RE.test(treeId)) return EMPTY_UNDO_STATE;
  const access = await requireActor();
  if (!access.ok) return EMPTY_UNDO_STATE;
  return withDbRetry(async (sql) => {
    const sandboxAccess = await sandboxAccessWithSql(sql, treeId, access.actor);
    if (!sandboxAccess?.canEdit) return EMPTY_UNDO_STATE;
    const summaries = await loadCommandSummaries(sql, treeId);
    const stacks = reconstructStacks(summaries);
    const undoCommandId = stacks.undo.at(-1) ?? null;
    const redoCommandId = stacks.redo.at(-1) ?? null;
    const undoLog = undoCommandId
      ? await loadCommandLog(sql, treeId, undoCommandId)
      : [];
    const redoLog = redoCommandId
      ? await loadCommandLog(sql, treeId, redoCommandId)
      : [];
    return {
      commandId: null,
      canUndo: Boolean(undoCommandId),
      canRedo: Boolean(redoCommandId),
      undoFocusNodeId: commandFocusNodeId(undoLog),
      redoFocusNodeId: commandFocusNodeId(redoLog),
      undoLog,
      redoLog,
      undoCommandId,
      redoCommandId,
    };
  });
}

async function runStackAction(
  treeId: string,
  direction: "undo" | "redo",
): Promise<ActionResult> {
  const startedAt = logStart();
  if (!UUID_RE.test(treeId)) {
    logSandboxActionRejection({
      operation: direction,
      eventName: `sandbox.${direction}.result`,
      failureReason: "Malformed id",
      startedAt,
      fields: { validation_target: "tree_id" },
    });
    return { ok: false, reason: "Malformed id" };
  }
  const access = await requireActor();
  if (!access.ok) {
    logSandboxActionRejection({
      operation: direction,
      eventName: `sandbox.${direction}.result`,
      failureReason: "Not allowed",
      startedAt,
      treeId,
      fields: { auth_status: access.status },
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
        const stacks = reconstructStacks(await loadCommandSummaries(tx, treeId));
        const tip = direction === "undo" ? stacks.undo.at(-1) : stacks.redo.at(-1);
        if (!tip) {
          rejected = {
            ok: false,
            reason: direction === "undo" ? "Nothing to undo" : "Nothing to redo",
          };
          return;
        }
        const log = await loadCommandLog(tx, treeId, tip);
        const command = {
          commandId: crypto.randomUUID(),
          kind: direction,
          undoesCommandId: tip,
        } as const;
        const touched = await applyCommandSql(
          tx,
          treeId,
          log,
          direction === "undo" ? "inverse" : "forward",
        );
        const outLog = direction === "undo" ? inverseLogRows(log) : log;
        for (const row of outLog) {
          await insertChangeLog(tx, {
            treeId,
            actor,
            op: row.op,
            nodeId: row.node_id,
            employeeAuthId: row.employee_auth_id,
            before: row.before,
            after: row.after,
            command,
          });
        }
        await tx`select organelle.validate_tree(${treeId})`;
        committed = await ackTouched(tx, treeId, touched, command.commandId);
      });
      return committed ?? rejected ?? { ok: false, reason: "Unknown failure" };
    },
    {
      logger: "sandbox.actions",
      operation: direction,
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        tree_id: treeId,
      },
    },
  );
  logSandboxActionOutcome({
    operation: direction,
    eventName: `sandbox.${direction}.result`,
    result,
    startedAt,
    actorAuthId: actor,
    actorRole: access.actor.role,
    treeId,
  });
  return result;
}

export async function undoLast(treeId: string): Promise<ActionResult> {
  return runStackAction(treeId, "undo");
}

export async function redoLast(treeId: string): Promise<ActionResult> {
  return runStackAction(treeId, "redo");
}

export interface HistoryRow {
  id: string;
  op: string;
  node_id: string | null;
  employee_auth_id: string | null;
  employee_name?: string | null;
  employee_avatar_url?: string | null;
  actor_name?: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
  command_id: string | null;
  command_kind: "user" | "undo" | "redo" | null;
  undoes_command_id: string | null;
}

export async function getSandboxHistory(treeId: string): Promise<HistoryRow[]> {
  if (!UUID_RE.test(treeId)) return [];
  const access = await requireRole(EDITOR_ROLES);
  if (!access.ok) return [];
  return withDbRetry(async (sql) => {
    const trees = await sql<{ kind: string; owner_auth_id: string | null }[]>`
      select kind, owner_auth_id
      from organelle.trees
      where tree_id = ${treeId}
    `;
    const tree = trees[0];
    if (
      !tree ||
      !canReadSandboxHistory({
        kind: tree.kind,
        ownerAuthId: tree.owner_auth_id,
        actorId: access.actor.authId,
        role: access.actor.role,
      })
    ) {
      return [];
    }
    const rows = await sql<HistoryRow[]>`
      select
        cl.id::text as id,
        cl.op::text as op,
        cl.node_id,
        coalesce(cl.employee_auth_id, (cl.before->'members'->>0)::uuid) as employee_auth_id,
        cl.before,
        cl.after,
        cl.created_at::text,
        cl.command_id::text as command_id,
        cl.command_kind::text as command_kind,
        cl.undoes_command_id::text as undoes_command_id,
        e.full_name as employee_name,
        e.avatar_url as employee_avatar_url,
        actor.full_name as actor_name
      from organelle.change_log cl
      left join organelle.employees e
        on e.auth_id = coalesce(cl.employee_auth_id, (cl.before->'members'->>0)::uuid)
      left join organelle.employees actor
        on actor.auth_id = cl.actor_auth_id
      where cl.tree_id = ${treeId}
      order by cl.id desc
    `;
    return rows;
  });
}
