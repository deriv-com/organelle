/**
 * Client-side drop validation. Mirrors the reject
 * table for instant red-target feedback; the server actions re-check
 * everything in the writing transaction. Pure — operates on the ChartRow list
 * (the full tree; collapse is a render concern) plus its index.
 */

import type { ChartIndex, ChartRow } from "../chart-row";
import { assistantChild } from "../chart-row";
import type { Zone } from "./zone";

export const MAX_TREE_DEPTH = 16;

export type NonRejectZone = Exclude<Zone, { zone: "reject" }>;

export type DropVerdict =
  { ok: true; zone: NonRejectZone; targetId: string } | { ok: false; reason: string };

function inSubtree(
  childrenById: Map<string, ChartRow[]>,
  ancestorId: string,
  id: string,
): boolean {
  const stack = [ancestorId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === id) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const child of childrenById.get(cur) ?? []) stack.push(child.id);
  }
  return false;
}

/** Height of the dragged subtree in levels below the dragged node (0 = leaf). */
function subtreeHeight(childrenById: Map<string, ChartRow[]>, id: string): number {
  let max = 0;
  const stack: Array<[string, number]> = [[id, 0]];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const [cur, depth] = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    max = Math.max(max, depth);
    for (const child of childrenById.get(cur) ?? []) stack.push([child.id, depth + 1]);
  }
  return max;
}

export function validateDrop(
  rows: ChartRow[],
  index: ChartIndex,
  draggedId: string,
  targetId: string | null,
  zone: Zone,
): DropVerdict {
  if (zone.zone === "reject") return { ok: false, reason: zone.reason };
  const dragged = rows.find((row) => row.id === draggedId);
  if (!dragged) return { ok: false, reason: "Unknown node" };
  if (dragged.parentId === "") return { ok: false, reason: "Can't move the root" };
  if (!targetId) return { ok: false, reason: "Drop on a card" };
  if (targetId === draggedId)
    return { ok: false, reason: "Can't drop a node onto itself" };
  if (zone.zone === "child" && targetId === dragged.parentId) {
    if (dragged.isAssistant) return { ok: true, zone, targetId };
    return { ok: false, reason: "Already under this manager" };
  }
  const target = rows.find((row) => row.id === targetId);
  if (!target) return { ok: false, reason: "Unknown target" };
  if (target.isAssistant) {
    return { ok: false, reason: "Can't drop onto an assistant" };
  }

  if (zone.zone === "peer") {
    if (dragged.kind !== "seat" || target.kind !== "seat") {
      return { ok: false, reason: "Can't merge a team into a seat" };
    }
    if (target.isAssistant) {
      return { ok: false, reason: "Can't add a peer to an assistant" };
    }
    const onTarget = new Set(target.members.map((m) => m.authId));
    if (dragged.members.some((m) => onTarget.has(m.authId))) {
      return { ok: false, reason: "Already on that seat" };
    }
    if (inSubtree(index.childrenById, draggedId, targetId)) {
      return { ok: false, reason: "Can't move a node into its own team" };
    }
    // The seat dissolves and its children move UP to its parent — no depth risk.
    return { ok: true, zone, targetId };
  }

  const parentId = zone.zone === "child" ? targetId : target.parentId;
  if (parentId === "") {
    return { ok: false, reason: "Can't move the root" };
  }
  if (inSubtree(index.childrenById, draggedId, parentId)) {
    return { ok: false, reason: "Can't move a node into its own team" };
  }
  const height = subtreeHeight(index.childrenById, draggedId);
  const parentDepth = index.depthById.get(parentId) ?? 0;
  if (parentDepth + 1 + height > MAX_TREE_DEPTH) {
    return {
      ok: false,
      reason: `Too deep — the tree can't exceed ${MAX_TREE_DEPTH} levels`,
    };
  }
  return { ok: true, zone, targetId };
}

export function canHostAssistant(
  rows: ChartRow[],
  index: ChartIndex,
  parentId: string,
  exceptId?: string,
): DropVerdict {
  const parent = rows.find((row) => row.id === parentId);
  if (!parent) return { ok: false, reason: "Unknown node" };
  if (parent.kind !== "seat") {
    return { ok: false, reason: "Assistants only under a person" };
  }
  const existing = assistantChild(index, parentId);
  if (existing && existing.id !== exceptId) {
    return { ok: false, reason: "Already has an assistant" };
  }
  return { ok: true, zone: { zone: "child" }, targetId: parentId };
}

export function canBeAssistant(
  rows: ChartRow[],
  index: ChartIndex,
  sourceId: string,
  parentId: string,
): DropVerdict {
  const source = rows.find((row) => row.id === sourceId);
  if (!source) return { ok: false, reason: "Unknown node" };
  if (source.kind !== "seat") {
    return { ok: false, reason: "Can't make a team an assistant" };
  }
  if ((index.childrenById.get(sourceId) ?? []).length > 0) {
    return { ok: false, reason: "Can't make a manager an assistant" };
  }
  if (source.members.length !== 1) {
    return { ok: false, reason: "Assistant must be one person" };
  }
  return canHostAssistant(rows, index, parentId, sourceId);
}

/** Node-only move would splice assistant children onto a seat that already has one. */
export function validateNodeOnlyDetach(
  rows: ChartRow[],
  index: ChartIndex,
  draggedId: string,
): DropVerdict | null {
  const dragged = rows.find((row) => row.id === draggedId);
  if (!dragged || dragged.parentId === "") return null;
  const dest = rows.find((row) => row.id === dragged.parentId);
  if (!dest || dest.kind !== "seat") return null;
  const destAssistant = assistantChild(index, dest.id);
  if (!destAssistant) return null;
  const leftover = (index.childrenById.get(draggedId) ?? []).some(
    (child) => child.isAssistant,
  );
  if (!leftover) return null;
  return { ok: false, reason: "Can't place a second assistant" };
}

/** Member drag: one person out of a seat. Peer zone
 *  joins the target seat; child/sibling zones create a new seat for them.
 *  Emptying the source dissolves it — except the root, which must keep a
 *  member. */
export function validateMemberDrop(
  rows: ChartRow[],
  index: ChartIndex,
  sourceSeatId: string,
  authId: string,
  targetId: string | null,
  zone: Zone,
): DropVerdict {
  if (zone.zone === "reject") return { ok: false, reason: zone.reason };
  const source = rows.find((row) => row.id === sourceSeatId);
  if (!source) return { ok: false, reason: "Unknown node" };
  if (!source.members.some((m) => m.authId === authId)) {
    return { ok: false, reason: "Not on this seat" };
  }
  if (!targetId) return { ok: false, reason: "Drop on a card" };
  if (targetId === sourceSeatId) return { ok: false, reason: "Already on this seat" };
  const target = rows.find((row) => row.id === targetId);
  if (!target) return { ok: false, reason: "Unknown target" };
  if (target.isAssistant) {
    return { ok: false, reason: "Can't drop onto an assistant" };
  }

  if (source.members.length === 1 && source.parentId === "") {
    return { ok: false, reason: "Can't move the last member off the root seat" };
  }

  if (zone.zone === "peer") {
    if (target.kind !== "seat") {
      return { ok: false, reason: "Can't merge into a team" };
    }
    if (target.isAssistant) {
      return { ok: false, reason: "Can't add a peer to an assistant" };
    }
    if (target.members.some((m) => m.authId === authId)) {
      return { ok: false, reason: "Already on that seat" };
    }
    return { ok: true, zone, targetId };
  }

  // child / sibling zones: a new seat is created for the person.
  const parentId = zone.zone === "child" ? targetId : target.parentId;
  if (parentId === "") {
    return { ok: false, reason: "Can't move the root" };
  }
  const parentDepth = index.depthById.get(parentId) ?? 0;
  if (parentDepth + 1 > MAX_TREE_DEPTH) {
    return {
      ok: false,
      reason: `Too deep — the tree can't exceed ${MAX_TREE_DEPTH} levels`,
    };
  }
  return { ok: true, zone, targetId };
}
