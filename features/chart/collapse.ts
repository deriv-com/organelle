/**
 * Collapse & paging.
 *
 * - Render collapsed to depth 2: the root (Publisher) and the department headers
 *   beneath it visible; anything deeper starts collapsed. Collapse state is
 *   client-only, never persisted.
 * - Paging at 30 children per parent, handled by d3-org-chart's built-in pager
 *   (`minPagingVisibleNodes` / `pagingStep`, state tracked in `data._pagingStep`).
 * - Split chip: expand/collapse next level vs whole subtree. A global budget of
 *   400 visible (`_expanded`) nodes applies to initial expansion, next-level,
 *   expand-all, mirrored charts, and search focus. Expand raises `_pagingStep`
 *   so children are not stuck behind the pager.
 *
 * `_expanded` is set on the data explicitly because the library's
 * `initialExpandLevel` guard (`> 1`) cannot express "two expanded levels".
 */

import type { ChartIndex, ChartRow } from "./chart-row";
import { teamChildren } from "./chart-row";
import type { ExpandMode } from "./expand-chip";

export const DEFAULT_VISIBLE_DEPTH = 2;
export const PAGE_SIZE = 30;
export const MAX_EXPANDED_NODES = 400;

export type ExpansionOutcome = {
  added: number;
  visible: number;
  limited: boolean;
};

export function countExpanded(rows: ChartRow[]): number {
  let count = 0;
  for (const row of rows) {
    if (row._expanded === true) count += 1;
  }
  return count;
}

export function remainingCapacity(rows: ChartRow[]): number {
  return Math.max(0, MAX_EXPANDED_NODES - countExpanded(rows));
}

function outcome(rows: ChartRow[], added: number, limited: boolean): ExpansionOutcome {
  return { added, visible: countExpanded(rows), limited };
}

export function applyInitialCollapse(
  rows: ChartRow[],
  index: ChartIndex,
): ExpansionOutcome {
  for (const row of rows) {
    const depth = index.depthById.get(row.id);
    if (depth === undefined) continue; // unreachable — buildChart already threw
    // Library semantics: `_expanded` on N means "N itself is visible" (its
    // ancestors are auto-expanded by expandSomeNodes) — so flagging through
    // depth 2 renders depths 1-2, not 1-1.
    row._expanded = depth <= DEFAULT_VISIBLE_DEPTH;
  }
  for (const row of rows) {
    if (!row.isAssistant) continue;
    const parentVisible =
      row.parentId === "" ||
      rows.find((p) => p.id === row.parentId)?._expanded === true;
    if (parentVisible) row._expanded = true;
  }
  const limited = trimToBudget(rows, index);
  return outcome(rows, countExpanded(rows), limited);
}

function trimToBudget(rows: ChartRow[], index: ChartIndex): boolean {
  if (countExpanded(rows) <= MAX_EXPANDED_NODES) return false;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const keep = new Set<string>();
  const queue = [index.rootId];
  while (queue.length > 0 && keep.size < MAX_EXPANDED_NODES) {
    const id = queue.shift()!;
    const row = byId.get(id);
    if (!row || row._expanded !== true || keep.has(id)) continue;
    keep.add(id);
    for (const child of childrenOf(index, id)) {
      if (child._expanded === true) queue.push(child.id);
    }
  }
  for (const row of rows) {
    row._expanded = keep.has(row.id);
  }
  return true;
}

export const pagingConfig = {
  minPagingVisibleNodes: () => PAGE_SIZE,
  pagingStep: () => PAGE_SIZE,
};

/** Expand exactly the ancestor path of `nodeId`; pure for chart-independent tests. */
export function ancestorPath(
  nodeId: string,
  parentOf: (id: string) => string,
): string[] {
  const path: string[] = [];
  let current = parentOf(nodeId);
  while (current !== "") {
    path.push(current);
    current = parentOf(current);
  }
  return path;
}

function childrenOf(index: ChartIndex, nodeId: string): ChartRow[] {
  return index.childrenById.get(nodeId) ?? [];
}

function teamOf(index: ChartIndex, nodeId: string): ChartRow[] {
  return teamChildren(index, nodeId);
}

function eachDescendant(
  index: ChartIndex,
  nodeId: string,
  fn: (row: ChartRow) => void,
): void {
  for (const child of childrenOf(index, nodeId)) {
    fn(child);
    eachDescendant(index, child.id, fn);
  }
}

function bumpPaging(parent: ChartRow, child: ChartRow, index: ChartIndex): void {
  const siblings = childrenOf(index, parent.id);
  const siblingIndex = siblings.findIndex((row) => row.id === child.id);
  // `j > _pagingStep` hides later siblings. Do not jump to siblings.length —
  // that would page in children the 400-node cap left collapsed.
  parent._pagingStep = Math.max(parent._pagingStep ?? 0, siblingIndex);
}

export function hasVisibleChildren(
  _rows: ChartRow[],
  index: ChartIndex,
  nodeId: string,
): boolean {
  return teamOf(index, nodeId).some((child) => child._expanded === true);
}

export function subtreeFullyExpanded(
  _rows: ChartRow[],
  index: ChartIndex,
  nodeId: string,
): boolean {
  const kids = childrenOf(index, nodeId);
  if (kids.length === 0) return true;
  let full = true;
  eachDescendant(index, nodeId, (row) => {
    if (row._expanded !== true) full = false;
  });
  return full;
}

function expandRows(
  rows: ChartRow[],
  index: ChartIndex,
  candidates: ChartRow[],
): ExpansionOutcome {
  const byId = new Map(rows.map((row) => [row.id, row]));
  let remaining = remainingCapacity(rows);
  let added = 0;
  let limited = false;
  for (const row of candidates) {
    if (row._expanded === true) continue;
    if (remaining <= 0) {
      limited = true;
      continue;
    }
    row._expanded = true;
    added += 1;
    remaining -= 1;
    const parent = byId.get(row.parentId);
    if (parent) bumpPaging(parent, row, index);
  }
  return outcome(rows, added, limited);
}

export function expandNextLevel(
  rows: ChartRow[],
  index: ChartIndex,
  nodeId: string,
): ExpansionOutcome {
  return expandRows(rows, index, teamOf(index, nodeId));
}

export function expandOneNode(
  rows: ChartRow[],
  index: ChartIndex,
  nodeId: string,
): ExpansionOutcome {
  const row = rows.find((candidate) => candidate.id === nodeId);
  if (!row) return outcome(rows, 0, false);
  return expandRows(rows, index, [row]);
}

export function collapseNextLevel(
  _rows: ChartRow[],
  index: ChartIndex,
  nodeId: string,
): void {
  eachDescendant(index, nodeId, (row) => {
    if (!row.isAssistant) row._expanded = false;
  });
}

export function collapseAllDescendants(
  _rows: ChartRow[],
  index: ChartIndex,
  nodeId: string,
): void {
  eachDescendant(index, nodeId, (row) => {
    if (!row.isAssistant) row._expanded = false;
  });
}

/** Apply the same expand/collapse chip action as org-chart. */
export function applyExpandChip(
  rows: ChartRow[],
  index: ChartIndex,
  nodeId: string,
  mode: ExpandMode,
): ExpansionOutcome {
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (!byId.has(nodeId)) return outcome(rows, 0, false);
  if (mode === "all") {
    if (subtreeFullyExpanded(rows, index, nodeId)) {
      collapseAllDescendants(rows, index, nodeId);
      return outcome(rows, 0, false);
    }
    return expandAllDescendants(rows, index, nodeId);
  }
  if (hasVisibleChildren(rows, index, nodeId)) {
    collapseNextLevel(rows, index, nodeId);
    return outcome(rows, 0, false);
  }
  return expandNextLevel(rows, index, nodeId);
}

export type ExpandChipSnapshot = {
  levelOpen: boolean;
  fullyExpanded: boolean;
};

/** Set expand state on a peer chart to match the source after a chip click (idempotent). */
export function applyExpandChipMirror(
  rows: ChartRow[],
  index: ChartIndex,
  nodeId: string,
  mode: ExpandMode,
  snapshot: ExpandChipSnapshot,
): ExpansionOutcome {
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (!byId.has(nodeId)) return outcome(rows, 0, false);

  if (mode === "all") {
    const currently = subtreeFullyExpanded(rows, index, nodeId);
    if (snapshot.fullyExpanded && !currently) {
      return expandAllDescendants(rows, index, nodeId);
    }
    if (!snapshot.fullyExpanded && currently) {
      collapseAllDescendants(rows, index, nodeId);
    }
    return outcome(rows, 0, false);
  }

  const currentlyOpen = hasVisibleChildren(rows, index, nodeId);
  if (snapshot.levelOpen && !currentlyOpen) {
    return expandNextLevel(rows, index, nodeId);
  }
  if (!snapshot.levelOpen && currentlyOpen) {
    collapseNextLevel(rows, index, nodeId);
  }
  return outcome(rows, 0, false);
}

export function expandAllDescendants(
  rows: ChartRow[],
  index: ChartIndex,
  nodeId: string,
): ExpansionOutcome {
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (!byId.has(nodeId)) return outcome(rows, 0, false);

  let remaining = remainingCapacity(rows);
  let added = 0;
  let limited = false;
  const queue = [...childrenOf(index, nodeId)];
  while (queue.length > 0) {
    const row = queue.shift()!;
    if (row._expanded !== true) {
      if (remaining <= 0) {
        limited = true;
        continue;
      }
      row._expanded = true;
      added += 1;
      remaining -= 1;
      const parent = byId.get(row.parentId);
      if (parent) bumpPaging(parent, row, index);
    }
    queue.push(...childrenOf(index, row.id));
  }
  return outcome(rows, added, limited);
}
