import type { CommandLogRow } from "./command-stack";

export type NodeVersion = {
  nodeId: string;
  rowVersion: number;
};

export type UndoChrome = {
  commandId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  undoFocusNodeId: string | null;
  redoFocusNodeId: string | null;
  undoLog: CommandLogRow[];
  redoLog: CommandLogRow[];
};

export const EMPTY_UNDO_CHROME: UndoChrome = {
  commandId: null,
  canUndo: false,
  canRedo: false,
  undoFocusNodeId: null,
  redoFocusNodeId: null,
  undoLog: [],
  redoLog: [],
};

export type PersistAck = {
  ok: true;
  versions: NodeVersion[];
} & UndoChrome;

export function toPersistAck(
  rows: { node_id: string; row_version: number | string }[],
  chrome: UndoChrome = EMPTY_UNDO_CHROME,
): PersistAck {
  return {
    ok: true,
    versions: rows.map((row) => ({
      nodeId: row.node_id,
      rowVersion: Number(row.row_version),
    })),
    ...chrome,
  };
}
