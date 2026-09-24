import type { Sql, TransactionSql } from "postgres";

import { logActionRejected, logActionResult } from "@/lib/app-logging";
import {
  commandFocusNodeId,
  reconstructStacks,
  type CommandLogRow,
  type CommandSummary,
} from "../command-stack";
import { toPersistAck, type PersistAck, type UndoChrome } from "../persist-ack";
import type { EmployeeDraft } from "@/features/directory/employee-fields";

export type ActionOk = PersistAck;
export interface ActionErr {
  ok: false;
  reason: string;
}
export type ActionResult = ActionOk | ActionErr;

export function logSandboxActionOutcome(args: {
  operation: string;
  eventName: string;
  result: ActionResult;
  startedAt: number;
  actorAuthId: string;
  actorRole: string;
  treeId: string;
  nodeId?: string | null;
  fields?: Record<string, unknown>;
}): void {
  logActionResult({
    logger: "sandbox.actions",
    operation: args.operation,
    eventName: args.eventName,
    result: args.result.ok ? "success" : "rejected",
    failureReason: args.result.ok ? undefined : args.result.reason,
    startedAt: args.startedAt,
    fields: {
      actor_auth_id: args.actorAuthId,
      actor_role: args.actorRole,
      tree_id: args.treeId,
      node_id: args.nodeId,
      command_id: args.result.ok ? args.result.commandId : undefined,
      touched_count: args.result.ok ? args.result.versions.length : undefined,
      ...(args.fields ?? {}),
    },
  });
}

export function logSandboxActionRejection(args: {
  operation: string;
  eventName: string;
  failureReason: string;
  startedAt: number;
  actorAuthId?: string;
  actorRole?: string;
  treeId?: string;
  nodeId?: string | null;
  fields?: Record<string, unknown>;
}): void {
  logActionRejected({
    logger: "sandbox.actions",
    operation: args.operation,
    eventName: args.eventName,
    failureReason: args.failureReason,
    startedAt: args.startedAt,
    fields: {
      actor_auth_id: args.actorAuthId,
      actor_role: args.actorRole,
      tree_id: args.treeId,
      node_id: args.nodeId,
      ...(args.fields ?? {}),
    },
  });
}

export async function loadCommandSummaries(
  tx: Sql | TransactionSql,
  treeId: string,
): Promise<CommandSummary[]> {
  const rows = await tx<
    { commandId: string; kind: string; undoesCommandId: string | null }[]
  >`
    select command_id::text as "commandId",
           min(command_kind::text) as kind,
           min(undoes_command_id::text) as "undoesCommandId"
      from organelle.change_log
     where tree_id = ${treeId} and command_id is not null
     group by command_id
     order by min(id)
  `;
  return rows.map((row) => ({
    commandId: row.commandId,
    kind: row.kind as CommandSummary["kind"],
    undoesCommandId: row.undoesCommandId,
  }));
}

export async function loadCommandLog(
  tx: Sql | TransactionSql,
  treeId: string,
  commandId: string,
): Promise<CommandLogRow[]> {
  return tx<CommandLogRow[]>`
    select op::text as op,
           node_id::text as node_id,
           employee_auth_id::text as employee_auth_id,
           before,
           after
      from organelle.change_log
     where tree_id = ${treeId} and command_id = ${commandId}
     order by id
  `;
}

export async function undoChromeFor(
  tx: TransactionSql,
  treeId: string,
  commandId: string | null,
): Promise<UndoChrome> {
  const stacks = reconstructStacks(await loadCommandSummaries(tx, treeId));
  const undoId = stacks.undo.at(-1) ?? null;
  const redoId = stacks.redo.at(-1) ?? null;
  const undoLog = undoId ? await loadCommandLog(tx, treeId, undoId) : [];
  const redoLog = redoId ? await loadCommandLog(tx, treeId, redoId) : [];
  return {
    commandId,
    canUndo: Boolean(undoId),
    canRedo: Boolean(redoId),
    undoFocusNodeId: commandFocusNodeId(undoLog),
    redoFocusNodeId: commandFocusNodeId(redoLog),
    undoLog,
    redoLog,
  };
}

export async function ackTouched(
  tx: TransactionSql,
  treeId: string,
  nodeIds: Iterable<string>,
  commandId: string | null = null,
): Promise<ActionOk> {
  const unique = [...new Set(nodeIds)];
  const chrome = await undoChromeFor(tx, treeId, commandId);
  if (unique.length === 0) return toPersistAck([], chrome);
  const rows = await tx<{ node_id: string; row_version: number }[]>`
    select node_id::text as node_id, row_version
      from organelle.nodes
     where tree_id = ${treeId}
       and node_id = any(${unique}::uuid[])
  `;
  return toPersistAck(rows, chrome);
}

export type CreateNodeArgs = {
  treeId: string;
  parentId: string;
  nodeId?: string;
} & (
  | { kind: "header"; name: string }
  | {
      kind: "seat";
      employeeAuthId?: string;
      newPerson?: EmployeeDraft;
      newPersonAuthId?: string;
      /** Required to reactivate an inactive or resigned person while adding a seat. */
      reactivateWithJoiningDate?: string;
      jobTitle: string;
      isAssistant?: boolean;
    }
);
