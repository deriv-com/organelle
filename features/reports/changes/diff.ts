/**
 * Diff seat snapshots between before and after trees.
 */

import { isHeaderRenameOnlyPathChange } from "./header-renames";
import { snapshotsEqual, type SeatSnapshot } from "./seat-snapshot";

export interface SeatChangePair {
  nodeId: string;
  before: SeatSnapshot | null;
  after: SeatSnapshot | null;
}

export function diffSeatSnapshots(
  before: Map<string, SeatSnapshot>,
  after: Map<string, SeatSnapshot>,
  renamedHeaderIds: Set<string>,
): SeatChangePair[] {
  const ids = new Set([...before.keys(), ...after.keys()]);
  const pairs: SeatChangePair[] = [];

  for (const nodeId of ids) {
    const b = before.get(nodeId) ?? null;
    const a = after.get(nodeId) ?? null;

    if (b && a && snapshotsEqual(b, a)) continue;

    if (
      b &&
      a &&
      b.parentSeatId === a.parentSeatId &&
      b.memberAuthIds.join(",") === a.memberAuthIds.join(",") &&
      isHeaderRenameOnlyPathChange(b.headerPathIds, a.headerPathIds, renamedHeaderIds)
    ) {
      continue;
    }

    if (b?.status === "resigned" || a?.status === "resigned") continue;

    pairs.push({ nodeId, before: b, after: a });
  }

  return pairs;
}
