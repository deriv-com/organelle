/**
 * Search focus: expand the target and every ancestor
 * so the card is visible, then the component centres and pulses.
 *
 * Default (isolate): collapse everything else — View on chart, deep links, Changes.
 * Chart search passes `preserveExpanded` so already-open teams stay open unless
 * the union would exceed MAX_EXPANDED_NODES; then isolate the ancestor path.
 *
 * Library semantics: `_expanded` on N means N itself is visible.
 */

import type { ChartRow } from "./chart-row";
import {
  countExpanded,
  MAX_EXPANDED_NODES,
  PAGE_SIZE,
  type ExpansionOutcome,
} from "./collapse";

export type ApplyFocusExpansionOptions = {
  /** Keep existing `_expanded` flags; only union-in the ancestor path. */
  preserveExpanded?: boolean;
};

function ancestorIds(rowsById: Map<string, ChartRow>, targetId: string): Set<string> {
  const visible = new Set<string>([targetId]);
  let cursor = rowsById.get(targetId)?.parentId ?? "";
  while (cursor !== "") {
    visible.add(cursor);
    cursor = rowsById.get(cursor)?.parentId ?? "";
  }
  return visible;
}

function isolatePath(rows: ChartRow[], visible: Set<string>): void {
  for (const row of rows) {
    row._expanded = visible.has(row.id);
  }
  for (const row of rows) {
    if (row.isAssistant && row.parentId !== "" && visible.has(row.parentId)) {
      row._expanded = true;
    }
  }
}

function pageTarget(
  rows: ChartRow[],
  rowsById: Map<string, ChartRow>,
  target: ChartRow,
): void {
  if (target.parentId === "") return;
  const parent = rowsById.get(target.parentId);
  if (!parent) return;
  const siblings = rows
    .filter((row) => row.parentId === target.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const index = siblings.findIndex((row) => row.id === target.id);
  if (index >= PAGE_SIZE) {
    parent._pagingStep = Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE;
  }
}

function unionWouldExceed(rows: ChartRow[], visible: Set<string>): boolean {
  const ids = new Set<string>();
  for (const row of rows) {
    if (Boolean(row._expanded) || visible.has(row.id)) ids.add(row.id);
  }
  for (const row of rows) {
    if (row.isAssistant && row.parentId !== "" && visible.has(row.parentId))
      ids.add(row.id);
  }
  return ids.size > MAX_EXPANDED_NODES;
}

export function applyFocusExpansion(
  rows: ChartRow[],
  targetId: string,
  options: ApplyFocusExpansionOptions = {},
): ExpansionOutcome | null {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const target = rowsById.get(targetId);
  if (!target) return null;

  const visible = ancestorIds(rowsById, targetId);
  const preserve = options.preserveExpanded === true;
  const isolate = !preserve || unionWouldExceed(rows, visible);

  if (isolate) {
    isolatePath(rows, visible);
  } else {
    for (const row of rows) {
      row._expanded = Boolean(row._expanded) || visible.has(row.id);
    }
    for (const row of rows) {
      if (row.isAssistant && row.parentId !== "" && visible.has(row.parentId)) {
        row._expanded = true;
      }
    }
  }

  pageTarget(rows, rowsById, target);

  const limited = preserve && isolate;
  return { added: 0, visible: countExpanded(rows), limited };
}

/** `_centered` is a one-shot: the library (or we) must clear it after render
 *  or the next layout snaps back and pan feels broken. */
export function clearCentered(rows: ChartRow[]): void {
  for (const row of rows) {
    if (row._centered) row._centered = false;
  }
}
