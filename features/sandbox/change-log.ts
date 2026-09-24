/**
 * Append-only change_log insert with optional command stamp.
 */

import type { TransactionSql } from "postgres";

export type CommandStamp = {
  commandId: string;
  kind: "user" | "undo" | "redo";
  undoesCommandId: string | null;
};

export async function insertChangeLog(
  tx: TransactionSql,
  args: {
    treeId: string;
    actor: string;
    op: string;
    nodeId?: string | null;
    employeeAuthId?: string | null;
    before?: unknown;
    after?: unknown;
    command: CommandStamp | null;
  },
): Promise<void> {
  const before = args.before == null ? null : tx.json(args.before as never);
  const after = args.after == null ? null : tx.json(args.after as never);
  await tx`
    insert into organelle.change_log
      (tree_id, actor_auth_id, op, node_id, employee_auth_id, before, after,
       command_id, command_kind, undoes_command_id)
    values (
      ${args.treeId},
      ${args.actor},
      ${args.op}::organelle.change_op,
      ${args.nodeId ?? null},
      ${args.employeeAuthId ?? null},
      ${before},
      ${after},
      ${args.command?.commandId ?? null},
      ${args.command ? args.command.kind : null}::organelle.command_kind,
      ${args.command?.undoesCommandId ?? null}
    )
  `;
}
