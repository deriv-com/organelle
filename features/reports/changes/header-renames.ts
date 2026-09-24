/**
 * Header rename detection for change report suppression.
 */

import type { ChartRow } from "@/features/chart/chart-row";

export interface HeaderRename {
  nodeId: string;
  beforeName: string;
  afterName: string;
}

export function findHeaderRenames(
  beforeRows: ChartRow[],
  afterRows: ChartRow[],
): HeaderRename[] {
  const beforeHeaders = new Map(
    beforeRows.filter((r) => r.kind === "header").map((r) => [r.id, r.name ?? ""]),
  );
  const renames: HeaderRename[] = [];
  for (const row of afterRows) {
    if (row.kind !== "header") continue;
    const prev = beforeHeaders.get(row.id);
    if (prev !== undefined && prev !== (row.name ?? "")) {
      renames.push({ nodeId: row.id, beforeName: prev, afterName: row.name ?? "" });
    }
  }
  return renames;
}

export function isHeaderRenameOnlyPathChange(
  beforePathIds: string[],
  afterPathIds: string[],
  renamedIds: Set<string>,
): boolean {
  if (beforePathIds.length !== afterPathIds.length) return false;
  for (let i = 0; i < beforePathIds.length; i++) {
    const b = beforePathIds[i]!;
    const a = afterPathIds[i]!;
    if (b !== a) return false;
    if (!renamedIds.has(b)) return false;
  }
  return renamedIds.size > 0;
}
