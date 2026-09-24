/**
 * Pure invert / re-apply of a sandbox command's change_log rows onto ChartRow[]
 *. Used for optimistic undo/redo paint.
 */

import type { ChartRow, SeatMember } from "@/features/chart/chart-row";
import {
  applyCreate,
  applyDelete,
  applyMove,
  applySetAssistant,
  applySetLeafGridColumns,
} from "@/features/chart/drag/apply";
import type { CommandLogRow } from "./command-stack";

const bySort = (a: ChartRow, b: ChartRow) => a.sortOrder - b.sortOrder;

function catalogMembers(rows: ChartRow[]): Map<string, SeatMember> {
  const catalog = new Map<string, SeatMember>();
  for (const row of rows) {
    for (const member of row.members) catalog.set(member.authId, member);
  }
  return catalog;
}

function memberOf(
  catalog: Map<string, SeatMember>,
  authId: string,
  isHost: boolean,
): SeatMember {
  const found = catalog.get(authId);
  if (found) return { ...found, isHost };
  return {
    authId,
    displayName: authId,
    displayTitle: "",
    email: "",
    avatarUrl: null,
    officeLocation: "",
    status: "active",
    joiningDate: null,
    isHost,
    sourceName: authId,
    sourceTitle: "",
    sourceAvatarUrl: null,
    overrideName: null,
    overrideTitle: null,
    overrideAvatarUrl: null,
  };
}

function parentOf(value: unknown): string {
  if (typeof value === "string" && value.length > 0) return value;
  return "";
}

function sortOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function placeNode(
  rows: ChartRow[],
  nodeId: string,
  parentId: string,
  sortOrder: number,
): ChartRow[] {
  const siblings = rows
    .filter((row) => row.parentId === parentId && row.id !== nodeId)
    .sort(bySort);
  const beforeSiblingId =
    sortOrder >= 0 && sortOrder < siblings.length ? siblings[sortOrder]!.id : null;
  return applyMove(rows, {
    kind: "move",
    nodeId,
    newParentId: parentId,
    beforeSiblingId,
  });
}

function removeMember(rows: ChartRow[], nodeId: string, authId: string): ChartRow[] {
  return rows.map((row) => {
    if (row.id !== nodeId) return row;
    const remaining = row.members.filter((member) => member.authId !== authId);
    if (remaining.length === row.members.length) return row;
    if (remaining.length > 0 && !remaining.some((member) => member.isHost)) {
      return {
        ...row,
        members: remaining.map((member, i) => ({ ...member, isHost: i === 0 })),
      };
    }
    return { ...row, members: remaining };
  });
}

function addMember(rows: ChartRow[], nodeId: string, member: SeatMember): ChartRow[] {
  return rows.map((row) => {
    if (row.id !== nodeId) return row;
    if (row.members.some((item) => item.authId === member.authId)) return row;
    if (member.isHost) {
      return {
        ...row,
        members: [
          { ...member, isHost: true },
          ...row.members.map((item) => ({ ...item, isHost: false })),
        ],
      };
    }
    return { ...row, members: [...row.members, { ...member, isHost: false }] };
  });
}

function restoreDeleted(
  rows: ChartRow[],
  entry: CommandLogRow,
  catalog: Map<string, SeatMember>,
): ChartRow[] {
  const nodeId = entry.node_id;
  if (!nodeId || rows.some((row) => row.id === nodeId)) return rows;
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const parentId = parentOf(before.parent_node_id);
  const sortOrder = sortOf(before.sort_order);
  const memberIds = Array.isArray(before.members)
    ? before.members.map(String)
    : entry.employee_auth_id
      ? [entry.employee_auth_id]
      : [];
  const reparented = Array.isArray(after.reparented)
    ? after.reparented.map(String)
    : [];

  const created: ChartRow =
    entry.op === "delete_header"
      ? {
          id: nodeId,
          parentId,
          kind: "header",
          sortOrder: 0,
          rowVersion: 1,
          name: String(before.name ?? ""),
          members: [],
        }
      : {
          id: nodeId,
          parentId,
          kind: "seat",
          sortOrder: 0,
          rowVersion: 1,
          jobTitle: String(before.job_title ?? "New position"),
          members: memberIds.map((id, i) => memberOf(catalog, id, i === 0)),
        };

  let next = [...rows, created];
  next = placeNode(next, nodeId, parentId, sortOrder);
  for (const childId of reparented) {
    next = applyMove(next, {
      kind: "move",
      nodeId: childId,
      newParentId: nodeId,
      beforeSiblingId: null,
    });
  }
  return next;
}

function applyRow(
  rows: ChartRow[],
  entry: CommandLogRow,
  catalog: Map<string, SeatMember>,
  direction: "forward" | "inverse",
): ChartRow[] {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const nodeId = entry.node_id;
  const from = direction === "forward" ? after : before;

  switch (entry.op) {
    case "move_node":
    case "reorder_node": {
      if (!nodeId) return rows;
      const parentId = parentOf(from.parent_node_id);
      let next = placeNode(rows, nodeId, parentId, sortOf(from.sort_order));
      if ("is_assistant" in from) {
        next = applySetAssistant(next, nodeId, Boolean(from.is_assistant));
      }
      return next;
    }
    case "set_assistant": {
      if (!nodeId) return rows;
      return applySetAssistant(rows, nodeId, Boolean(from.is_assistant));
    }
    case "set_leaf_grid_columns": {
      if (!nodeId) return rows;
      return applySetLeafGridColumns(rows, nodeId, Number(from.leaf_grid_columns ?? 3));
    }
    case "rename_header": {
      if (!nodeId) return rows;
      const name = String(from.name ?? "");
      return rows.map((row) => (row.id === nodeId ? { ...row, name } : row));
    }
    case "create_header":
    case "create_seat": {
      if (direction === "forward") {
        if (!nodeId) return rows;
        if (entry.op === "create_header") {
          const next = applyCreate(rows, {
            kind: "header",
            nodeId,
            parentId: parentOf(after.parent_node_id),
            name: String(after.name ?? ""),
          });
          return placeNode(
            next,
            nodeId,
            parentOf(after.parent_node_id),
            sortOf(after.sort_order),
          );
        }
        const authId = entry.employee_auth_id;
        if (!authId) return rows;
        const next = applyCreate(rows, {
          kind: "seat",
          nodeId,
          parentId: parentOf(after.parent_node_id),
          member: memberOf(catalog, authId, true),
          jobTitle: String(after.job_title ?? "New position"),
          isAssistant: Boolean(after.is_assistant),
        });
        return placeNode(
          next,
          nodeId,
          parentOf(after.parent_node_id),
          sortOf(after.sort_order),
        );
      }
      if (!nodeId) return rows;
      return applyDelete(rows, nodeId);
    }
    case "delete_header":
    case "delete_seat": {
      if (direction === "forward") {
        if (!nodeId) return rows;
        return applyDelete(rows, nodeId);
      }
      return restoreDeleted(rows, entry, catalog);
    }
    case "assign_employee": {
      if (!nodeId || !entry.employee_auth_id) return rows;
      if (direction === "forward") {
        const isHost = Boolean(after.is_host);
        return addMember(
          rows,
          nodeId,
          memberOf(catalog, entry.employee_auth_id, isHost),
        );
      }
      return removeMember(rows, nodeId, entry.employee_auth_id);
    }
    case "unassign_employee": {
      if (!nodeId || !entry.employee_auth_id) return rows;
      if (direction === "forward") {
        return removeMember(rows, nodeId, entry.employee_auth_id);
      }
      const isHost = Boolean(before.is_host);
      return addMember(rows, nodeId, memberOf(catalog, entry.employee_auth_id, isHost));
    }
    case "set_peer_host": {
      if (!nodeId || !entry.employee_auth_id) return rows;
      if (direction === "forward") {
        return rows.map((row) => {
          if (row.id !== nodeId) return row;
          return {
            ...row,
            members: row.members.map((member) => ({
              ...member,
              isHost: member.authId === entry.employee_auth_id,
            })),
          };
        });
      }
      const previous =
        typeof before.previous_host === "string" ? before.previous_host : null;
      return rows.map((row) => {
        if (row.id !== nodeId) return row;
        return {
          ...row,
          members: row.members.map((member) => ({
            ...member,
            isHost: previous
              ? member.authId === previous
              : member.authId !== entry.employee_auth_id,
          })),
        };
      });
    }
    default:
      return rows;
  }
}

function run(
  rows: ChartRow[],
  log: CommandLogRow[],
  direction: "forward" | "inverse",
): ChartRow[] {
  const catalog = catalogMembers(rows);
  const ordered = direction === "inverse" ? [...log].reverse() : log;
  let next = rows;
  for (const entry of ordered) {
    next = applyRow(next, entry, catalog, direction);
    for (const row of next) {
      for (const member of row.members) catalog.set(member.authId, member);
    }
  }
  return next;
}

export function invertCommand(rows: ChartRow[], log: CommandLogRow[]): ChartRow[] {
  return run(rows, log, "inverse");
}

export function applyCommand(rows: ChartRow[], log: CommandLogRow[]): ChartRow[] {
  return run(rows, log, "forward");
}

/** Inverse log rows written for an undo command (append-only). */
export function inverseLogRows(log: CommandLogRow[]): CommandLogRow[] {
  return [...log].reverse().map((entry) => {
    switch (entry.op) {
      case "move_node":
      case "reorder_node":
      case "rename_header":
      case "set_assistant":
      case "set_leaf_grid_columns":
        return { ...entry, before: entry.after, after: entry.before };
      case "create_header":
        return {
          op: "delete_header",
          node_id: entry.node_id,
          employee_auth_id: null,
          before: {
            parent_node_id: entry.after?.parent_node_id ?? null,
            name: entry.after?.name ?? null,
            sort_order: entry.after?.sort_order ?? 0,
          },
          after: { reparented: [] },
        };
      case "create_seat":
        return {
          op: "delete_seat",
          node_id: entry.node_id,
          employee_auth_id: entry.employee_auth_id,
          before: {
            parent_node_id: entry.after?.parent_node_id ?? null,
            job_title: entry.after?.job_title ?? null,
            members: entry.employee_auth_id ? [entry.employee_auth_id] : [],
            sort_order: entry.after?.sort_order ?? 0,
          },
          after: { reparented: [] },
        };
      case "delete_header":
        return {
          op: "create_header",
          node_id: entry.node_id,
          employee_auth_id: null,
          before: null,
          after: {
            parent_node_id: entry.before?.parent_node_id ?? null,
            name: entry.before?.name ?? null,
            sort_order: entry.before?.sort_order ?? 0,
          },
        };
      case "delete_seat":
        return {
          op: "create_seat",
          node_id: entry.node_id,
          employee_auth_id: entry.employee_auth_id,
          before: null,
          after: {
            parent_node_id: entry.before?.parent_node_id ?? null,
            job_title: entry.before?.job_title ?? null,
            sort_order: entry.before?.sort_order ?? 0,
          },
        };
      case "assign_employee":
        return {
          ...entry,
          op: "unassign_employee",
          before: entry.after,
          after: null,
        };
      case "unassign_employee":
        return {
          ...entry,
          op: "assign_employee",
          before: null,
          after: entry.before,
        };
      case "set_peer_host": {
        const previous =
          typeof entry.before?.previous_host === "string"
            ? entry.before.previous_host
            : null;
        return {
          op: "set_peer_host",
          node_id: entry.node_id,
          employee_auth_id: previous,
          before: { previous_host: entry.employee_auth_id },
          after: { is_host: true },
        };
      }
      default:
        return entry;
    }
  });
}
