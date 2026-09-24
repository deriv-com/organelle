/**
 * Reconstruct sandbox undo/redo stacks from stamped change_log commands.
 */

export type CommandKind = "user" | "undo" | "redo";

export type CommandSummary = {
  commandId: string;
  kind: CommandKind;
  undoesCommandId: string | null;
};

export type CommandStacks = {
  undo: string[];
  redo: string[];
};

export function reconstructStacks(commands: CommandSummary[]): CommandStacks {
  const undo: string[] = [];
  const redo: string[] = [];
  for (const command of commands) {
    if (command.kind === "user") {
      undo.push(command.commandId);
      redo.length = 0;
      continue;
    }
    if (command.kind === "undo") {
      undo.pop();
      if (command.undoesCommandId) redo.push(command.undoesCommandId);
      continue;
    }
    const redone = redo.pop();
    if (redone) undo.push(redone);
  }
  return { undo, redo };
}

export function userCommand(): {
  commandId: string;
  kind: "user";
  undoesCommandId: null;
} {
  return { commandId: crypto.randomUUID(), kind: "user", undoesCommandId: null };
}

const CAPSTONE_OPS = new Set([
  "delete_header",
  "delete_seat",
  "create_header",
  "create_seat",
  "move_node",
  "reorder_node",
  "rename_header",
  "set_assistant",
  "set_leaf_grid_columns",
]);

export type CommandLogRow = {
  op: string;
  node_id: string | null;
  employee_auth_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export function commandFocusNodeId(log: CommandLogRow[]): string | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const row = log[i]!;
    if (row.node_id && CAPSTONE_OPS.has(row.op)) return row.node_id;
  }
  return log.find((row) => row.node_id)?.node_id ?? null;
}

export function representativeLogRow(log: CommandLogRow[]): CommandLogRow | null {
  if (log.length === 0) return null;
  const ranked = [...log].sort((a, b) => capstoneRank(a.op) - capstoneRank(b.op));
  return ranked[0] ?? null;
}

function capstoneRank(op: string): number {
  if (op.startsWith("delete_")) return 0;
  if (op.startsWith("create_")) return 1;
  if (op === "move_node" || op === "reorder_node") return 2;
  if (op === "rename_header") return 3;
  if (op === "assign_employee" || op === "unassign_employee") return 4;
  return 5;
}
