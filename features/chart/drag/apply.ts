/**
 * Optimistic drop application. Pure
 * transforms on the ChartRow list — the client applies them instantly, the
 * server action performs the equivalent in SQL, and on failure the client
 * restores its pre-drop snapshot. Shared with the unit tests.
 */

import { leafGridColumnsOf } from "../grid-org-chart";
import type { ChartRow, SeatMember } from "../chart-row";
import { isFirstSeatForPerson, restorePrimaries } from "../primary-seat";
import { PAGE_SIZE } from "../collapse";
import type { DropVerdict } from "./validate";

export interface MoveDrop {
  kind: "move";
  nodeId: string;
  newParentId: string;
  /** Insert before this sibling; null appends last. */
  beforeSiblingId: string | null;
  asAssistant?: boolean;
}

export interface PeerDrop {
  kind: "peer";
  sourceSeatId: string;
  targetSeatId: string;
}

/** Member drag: one person onto another seat. */
export interface MemberPeerDrop {
  kind: "member-peer";
  sourceSeatId: string;
  authId: string;
  targetSeatId: string;
}

/** Member drag onto a header / sibling gap: a new seat is created for them. */
export interface MemberNewSeatDrop {
  kind: "member-new-seat";
  sourceSeatId: string;
  authId: string;
  parentId: string;
  beforeSiblingId: string | null;
  /** Client-issued id so the optimistic card persists as the same node. */
  newSeatId?: string;
  asAssistant?: boolean;
}

export type Drop = MoveDrop | PeerDrop | MemberPeerDrop | MemberNewSeatDrop;

/** True when a move drop must open the subtree vs node-only dialog.
 *  Same-parent reorder always carries the subtree. */
export function shouldAskMoveMode(drop: MoveDrop, rows: ChartRow[]): boolean {
  if (drop.asAssistant) return false;
  const dragged = rows.find((row) => row.id === drop.nodeId);
  if (!dragged) return false;
  if (drop.newParentId === dragged.parentId) return false;
  return rows.some((row) => row.parentId === drop.nodeId);
}

/** Translate a validated zone drop into the two canonical operations. */
export function toDrop(
  draggedId: string,
  verdict: DropVerdict,
  rows: ChartRow[],
): Drop | null {
  if (!verdict.ok) return null;
  if (verdict.zone.zone === "peer") {
    return { kind: "peer", sourceSeatId: draggedId, targetSeatId: verdict.targetId };
  }
  if (verdict.zone.zone === "child") {
    return {
      kind: "move",
      nodeId: draggedId,
      newParentId: verdict.targetId,
      beforeSiblingId: null,
    };
  }
  const target = rows.find((row) => row.id === verdict.targetId);
  if (!target) return null;
  let beforeSiblingId: string | null = verdict.targetId;
  if (verdict.zone.zone === "sibling-after") {
    const siblings = rows
      .filter((row) => row.parentId === target.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const at = siblings.findIndex((row) => row.id === target.id);
    beforeSiblingId = siblings[at + 1]?.id ?? null;
  }
  return {
    kind: "move",
    nodeId: draggedId,
    newParentId: target.parentId,
    beforeSiblingId,
  };
}

/** Translate a validated member-drag zone drop into the canonical operations. */
export function toMemberDrop(
  sourceSeatId: string,
  authId: string,
  verdict: DropVerdict,
  rows: ChartRow[],
): Drop | null {
  if (!verdict.ok) return null;
  if (verdict.zone.zone === "peer") {
    return {
      kind: "member-peer",
      sourceSeatId,
      authId,
      targetSeatId: verdict.targetId,
    };
  }
  if (verdict.zone.zone === "child") {
    return {
      kind: "member-new-seat",
      sourceSeatId,
      authId,
      parentId: verdict.targetId,
      beforeSiblingId: null,
    };
  }
  const target = rows.find((row) => row.id === verdict.targetId);
  if (!target) return null;
  let beforeSiblingId: string | null = verdict.targetId;
  if (verdict.zone.zone === "sibling-after") {
    const siblings = rows
      .filter((row) => row.parentId === target.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const at = siblings.findIndex((row) => row.id === target.id);
    beforeSiblingId = siblings[at + 1]?.id ?? null;
  }
  return {
    kind: "member-new-seat",
    sourceSeatId,
    authId,
    parentId: target.parentId,
    beforeSiblingId,
  };
}

const bySort = (a: ChartRow, b: ChartRow) => a.sortOrder - b.sortOrder;

export function applyMove(rows: ChartRow[], drop: MoveDrop): ChartRow[] {
  const node = rows.find((row) => row.id === drop.nodeId);
  if (!node) return rows;
  const oldParentId = node.parentId;

  const newSiblings = rows
    .filter((row) => row.parentId === drop.newParentId && row.id !== drop.nodeId)
    .sort(bySort);
  let insertAt = drop.beforeSiblingId
    ? newSiblings.findIndex((row) => row.id === drop.beforeSiblingId)
    : -1;
  if (insertAt === -1) insertAt = newSiblings.length;
  newSiblings.splice(insertAt, 0, node);

  const updates = new Map<string, Partial<ChartRow>>();
  newSiblings.forEach((row, i) => updates.set(row.id, { sortOrder: i }));
  updates.set(drop.nodeId, {
    parentId: drop.newParentId,
    sortOrder: insertAt,
    isAssistant: drop.asAssistant === true,
  });

  if (oldParentId !== drop.newParentId) {
    rows
      .filter((row) => row.parentId === oldParentId && row.id !== drop.nodeId)
      .sort(bySort)
      .forEach((row, i) => updates.set(row.id, { sortOrder: i }));
  }

  // A drop the user can't see looks like a failure: page the parent
  // forward so the dropped node is visible.
  if (newSiblings.length > PAGE_SIZE) {
    updates.set(drop.newParentId, {
      _pagingStep: Math.ceil((insertAt + 1) / PAGE_SIZE),
    });
  }

  return rows.map((row) =>
    updates.has(row.id) ? { ...row, ...updates.get(row.id) } : row,
  );
}

/** Optimistic mirror of moveNode's node-only mode:
 *  the children splice into the old parent's list at the node's former
 *  position (applyDelete's splice rule), then the node moves alone. */
export function applyMoveNodeOnly(rows: ChartRow[], drop: MoveDrop): ChartRow[] {
  const node = rows.find((row) => row.id === drop.nodeId);
  if (!node || node.parentId === "") return rows;

  const updates = new Map<string, Partial<ChartRow>>();
  const children = rows
    .filter((row) => row.parentId === node.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const oldOrder = rows
    .filter((row) => row.parentId === node.parentId && row.id !== node.id)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => row.id);
  const insertAt = Math.min(node.sortOrder, oldOrder.length);
  oldOrder.splice(insertAt, 0, ...children.map((child) => child.id));
  oldOrder.forEach((id, index) => {
    const row = rows.find((candidate) => candidate.id === id)!;
    const reparented = row.parentId === node.id;
    const dest = rows.find((candidate) => candidate.id === node.parentId);
    updates.set(id, {
      sortOrder: index,
      ...(reparented ? { parentId: node.parentId } : {}),
      ...(reparented && row.isAssistant && dest?.kind === "header"
        ? { isAssistant: false }
        : {}),
    });
  });

  const detached = rows.map((row) =>
    updates.has(row.id) ? { ...row, ...updates.get(row.id) } : row,
  );
  return applyMove(detached, drop);
}

export function applyPeer(rows: ChartRow[], drop: PeerDrop): ChartRow[] {
  const source = rows.find((row) => row.id === drop.sourceSeatId);
  const target = rows.find((row) => row.id === drop.targetSeatId);
  if (!source || !target) return rows;

  const updates = new Map<string, Partial<ChartRow>>();
  updates.set(drop.targetSeatId, {
    members: [
      ...target.members,
      ...source.members.map((m) => ({ ...m, isHost: false })),
    ],
  });

  // Children of the dissolved seat reparent to its parent, appended last.
  const children = rows.filter((row) => row.parentId === source.id).sort(bySort);
  const siblings = rows
    .filter((row) => row.parentId === source.parentId && row.id !== source.id)
    .sort(bySort);
  const order = [...siblings, ...children];
  order.forEach((row, i) => {
    updates.set(row.id, {
      ...updates.get(row.id),
      sortOrder: i,
      ...(row.parentId === source.id ? { parentId: source.parentId } : {}),
    });
  });

  return rows
    .filter((row) => row.id !== source.id)
    .map((row) => (updates.has(row.id) ? { ...row, ...updates.get(row.id) } : row));
}

/** Optimistic mirror of deleteNode: the node is
 *  removed and its children are spliced into the grandparent's sibling list
 *  at the deleted node's former position, preserving their relative order. */
export function applyDelete(rows: ChartRow[], nodeId: string): ChartRow[] {
  const node = rows.find((row) => row.id === nodeId);
  if (!node || node.parentId === "") return rows;

  const children = rows.filter((row) => row.parentId === nodeId).sort(bySort);
  const siblings = rows
    .filter((row) => row.parentId === node.parentId && row.id !== nodeId)
    .sort(bySort);

  const order = siblings.map((row) => row.id);
  const insertAt = Math.min(node.sortOrder, order.length);
  order.splice(insertAt, 0, ...children.map((row) => row.id));

  const destHasAssistant = siblings.some((row) => row.isAssistant);
  const dest = rows.find((row) => row.id === node.parentId);
  const updates = new Map<string, Partial<ChartRow>>();
  order.forEach((id, i) => {
    const row = rows.find((candidate) => candidate.id === id)!;
    const reparented = row.parentId === nodeId;
    const clearAssistant =
      reparented && row.isAssistant && (dest?.kind === "header" || destHasAssistant);
    updates.set(id, {
      sortOrder: i,
      ...(reparented ? { parentId: node.parentId } : {}),
      ...(clearAssistant ? { isAssistant: false } : {}),
    });
  });

  return restorePrimaries(
    rows
      .filter((row) => row.id !== nodeId)
      .map((row) => (updates.has(row.id) ? { ...row, ...updates.get(row.id) } : row)),
  );
}

/** Optimistic mirror of moveMember's peer variant:
 *  the member joins the target as a non-host; if the host left, the next
 *  member is promoted; if the source emptied, it dissolves and its children
 *  splice into the grandparent at its former position (applyDelete's rule). */
export function applyMemberMove(rows: ChartRow[], drop: MemberPeerDrop): ChartRow[] {
  const source = rows.find((row) => row.id === drop.sourceSeatId);
  const target = rows.find((row) => row.id === drop.targetSeatId);
  if (!source || !target) return rows;
  const member = source.members.find((m) => m.authId === drop.authId);
  if (!member) return rows;

  const withTarget = rows.map((row) =>
    row.id === target.id
      ? { ...row, members: [...row.members, { ...member, isHost: false }] }
      : row,
  );

  const remaining = source.members.filter((m) => m.authId !== drop.authId);
  if (remaining.length > 0) {
    return withTarget.map((row) =>
      row.id === source.id
        ? {
            ...row,
            members: member.isHost
              ? remaining.map((m, i) => ({ ...m, isHost: i === 0 }))
              : remaining,
          }
        : row,
    );
  }
  return applyDelete(withTarget, source.id);
}

/** Optimistic mirror of moveMember's new-seat variant:
 *  a new seat is created with the member as host at the drop position; the
 *  source keeps remaining members (host promoted if needed) or dissolves. */
export function applyMemberNewSeat(
  rows: ChartRow[],
  drop: MemberNewSeatDrop,
): ChartRow[] {
  if (!drop.newSeatId) return rows;
  const source = rows.find((row) => row.id === drop.sourceSeatId);
  if (!source) return rows;
  const member = source.members.find((m) => m.authId === drop.authId);
  if (!member) return rows;
  if (drop.parentId !== "" && !rows.some((row) => row.id === drop.parentId))
    return rows;

  const remaining = source.members.filter((m) => m.authId !== drop.authId);
  const withoutMember =
    remaining.length > 0
      ? rows.map((row) =>
          row.id === source.id
            ? {
                ...row,
                members: member.isHost
                  ? remaining.map((m, i) => ({ ...m, isHost: i === 0 }))
                  : remaining,
              }
            : row,
        )
      : applyDelete(rows, source.id);

  const newSeat: ChartRow = {
    id: drop.newSeatId,
    parentId: drop.parentId,
    kind: "seat",
    sortOrder: 0,
    rowVersion: 1,
    jobTitle: member.displayTitle || source.jobTitle,
    isAssistant: drop.asAssistant === true,
    members: [{ ...member, isHost: true }],
  };

  const siblings = withoutMember
    .filter((row) => row.parentId === drop.parentId)
    .sort(bySort);
  let insertAt = drop.beforeSiblingId
    ? siblings.findIndex((row) => row.id === drop.beforeSiblingId)
    : -1;
  if (insertAt === -1) insertAt = siblings.length;
  siblings.splice(insertAt, 0, newSeat);

  const updates = new Map<string, Partial<ChartRow>>();
  siblings.forEach((row, i) => updates.set(row.id, { sortOrder: i }));
  if (siblings.length > PAGE_SIZE) {
    updates.set(drop.parentId, {
      _pagingStep: Math.ceil((insertAt + 1) / PAGE_SIZE),
    });
  }

  return [...withoutMember, newSeat].map((row) =>
    updates.has(row.id) ? { ...row, ...updates.get(row.id) } : row,
  );
}

export type CreateApply =
  | { kind: "header"; nodeId: string; parentId: string; name: string }
  | {
      kind: "seat";
      nodeId: string;
      parentId: string;
      member: SeatMember;
      jobTitle: string;
      isAssistant?: boolean;
    };

/** Optimistic mirror of createNode: append last under the parent. */
export function applyCreate(rows: ChartRow[], spec: CreateApply): ChartRow[] {
  if (spec.parentId !== "" && !rows.some((row) => row.id === spec.parentId)) {
    return rows;
  }
  const created: ChartRow =
    spec.kind === "header"
      ? {
          id: spec.nodeId,
          parentId: spec.parentId,
          kind: "header",
          sortOrder: 0,
          rowVersion: 1,
          leafGridColumns: 3,
          name: spec.name,
          members: [],
        }
      : {
          id: spec.nodeId,
          parentId: spec.parentId,
          kind: "seat",
          sortOrder: 0,
          rowVersion: 1,
          leafGridColumns: 3,
          jobTitle: spec.jobTitle,
          isAssistant: spec.isAssistant === true,
          members: [
            {
              ...spec.member,
              isHost: true,
              isPrimary:
                spec.member.isPrimary ?? isFirstSeatForPerson(rows, spec.member.authId),
            },
          ],
        };

  const siblings = rows.filter((row) => row.parentId === spec.parentId).sort(bySort);
  const insertAt = siblings.length;
  siblings.push(created);

  const updates = new Map<string, Partial<ChartRow>>();
  siblings.forEach((row, i) => updates.set(row.id, { sortOrder: i }));
  updates.set(spec.parentId, { _expanded: true });
  if (siblings.length > PAGE_SIZE) {
    updates.set(spec.parentId, {
      ...updates.get(spec.parentId),
      _pagingStep: Math.ceil((insertAt + 1) / PAGE_SIZE),
    });
  }

  return [...rows, created].map((row) =>
    updates.has(row.id) ? { ...row, ...updates.get(row.id) } : row,
  );
}

export function applySetAssistant(
  rows: ChartRow[],
  nodeId: string,
  isAssistant: boolean,
): ChartRow[] {
  return rows.map((row) => (row.id === nodeId ? { ...row, isAssistant } : row));
}

export function applySetLeafGridColumns(
  rows: ChartRow[],
  nodeId: string,
  columns: number,
): ChartRow[] {
  const leafGridColumns = leafGridColumnsOf({ leafGridColumns: columns });
  return rows.map((row) => (row.id === nodeId ? { ...row, leafGridColumns } : row));
}
