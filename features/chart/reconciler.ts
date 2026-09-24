/**
 * Render reconciler. When the node data changes, never recreate the
 * chart — classify the change and patch the live instance:
 *
 * - same:                   new array, same content → do nothing
 * - content:                fields only → patch data, restyleForeignObjectElements()
 * - structural-preserving:  ids/parents/order changed → rebuild data, carry
 *                           `_expanded`/`_pagingStep` by node_id, render() WITHOUT fit()
 * - structural-refit:       different tree entirely → rebuild, render() WITH fit()
 *
 * This module is the pure classification half; the d3 calls live in org-chart.tsx.
 */

import type { ChartRow, SeatMember } from "./chart-row";

export type ReconcileTier =
  "same" | "content" | "structural-preserving" | "structural-refit";

function memberEquals(a: SeatMember, b: SeatMember): boolean {
  return (
    a.authId === b.authId &&
    a.displayName === b.displayName &&
    a.displayTitle === b.displayTitle &&
    a.email === b.email &&
    a.avatarUrl === b.avatarUrl &&
    a.officeLocation === b.officeLocation &&
    a.status === b.status &&
    a.joiningDate === b.joiningDate &&
    a.isHost === b.isHost &&
    a.positionLevel === b.positionLevel &&
    a.servingNoticeMuted === b.servingNoticeMuted
  );
}

function contentEquals(a: ChartRow, b: ChartRow): boolean {
  if (a.kind !== b.kind || a.name !== b.name || a.jobTitle !== b.jobTitle) return false;
  if (a.members.length !== b.members.length) return false;
  return a.members.every((member, i) => memberEquals(member, b.members[i]!));
}

export function classifyUpdate(
  oldRows: ChartRow[],
  newRows: ChartRow[],
  opts: { treeChanged: boolean },
): ReconcileTier {
  if (opts.treeChanged) return "structural-refit";

  const oldById = new Map(oldRows.map((row) => [row.id, row]));
  const newById = new Map(newRows.map((row) => [row.id, row]));

  for (const id of oldById.keys()) {
    if (!newById.has(id)) return "structural-preserving";
  }

  let tier: ReconcileTier = "same";
  for (const [id, next] of newById) {
    const prev = oldById.get(id);
    if (!prev) return "structural-preserving";
    if (prev.parentId !== next.parentId || prev.sortOrder !== next.sortOrder) {
      return "structural-preserving";
    }
    if (Boolean(prev.isAssistant) !== Boolean(next.isAssistant)) {
      return "structural-preserving";
    }
    if ((prev.leafGridColumns ?? 3) !== (next.leafGridColumns ?? 3)) {
      return "structural-preserving";
    }
    if (tier === "same" && !contentEquals(prev, next)) tier = "content";
  }
  return tier;
}

/** Carry exactly `_expanded` and `_pagingStep` across a structural rebuild. */
export function carryRenderState(oldRows: ChartRow[], newRows: ChartRow[]): void {
  const oldById = new Map(oldRows.map((row) => [row.id, row]));
  for (const row of newRows) {
    const prev = oldById.get(row.id);
    if (!prev) continue;
    if (prev._expanded !== undefined) row._expanded = prev._expanded;
    if (prev._pagingStep !== undefined) row._pagingStep = prev._pagingStep;
  }
}

/** Mutate the live d3-bound row so restyleForeignObjectElements sees new fields. */
export function patchLiveContent(live: ChartRow, next: ChartRow): void {
  live.name = next.name;
  live.jobTitle = next.jobTitle;
  live.members = next.members;
}
