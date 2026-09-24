/**
 * Chart rows → nested header-only options for the directory header filter.
 *
 * Headers and seats interleave: departments hang under the Publisher seat and teams hang
 * under a manager seat inside their department. So a header nests under its nearest
 * *ancestor* header, skipping any seats in between — the same rule the integrations
 * header tree uses.
 */

import type { ChartRow } from "@/features/chart/chart-row";

import type { HeaderOption } from "./filter-bar";

const ROOT = "";

function nearestHeaderParent(id: string, byId: Map<string, ChartRow>): string {
  let current = byId.get(id)?.parentId ?? ROOT;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) return ROOT;
    seen.add(current);
    const node = byId.get(current);
    if (!node) return ROOT;
    if (node.kind === "header") return current;
    current = node.parentId;
  }
  return ROOT;
}

export function buildHeaderOptions(rows: ChartRow[]): HeaderOption[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const childrenByParent = new Map<string, ChartRow[]>();
  for (const row of rows) {
    if (row.kind !== "header") continue;
    const parentId = nearestHeaderParent(row.id, byId);
    const list = childrenByParent.get(parentId) ?? [];
    list.push(row);
    childrenByParent.set(parentId, list);
  }

  for (const list of childrenByParent.values()) {
    list.sort(
      (a, b) => (a.name ?? "").localeCompare(b.name ?? "") || a.id.localeCompare(b.id),
    );
  }

  function nest(row: ChartRow): HeaderOption {
    return {
      id: row.id,
      name: row.name ?? "",
      children: (childrenByParent.get(row.id) ?? []).map(nest),
    };
  }

  return (childrenByParent.get(ROOT) ?? []).map(nest);
}
