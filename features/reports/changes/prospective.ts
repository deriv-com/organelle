/** Report-facing seat changes for a prospective merge. */

import { buildChart } from "@/features/chart/chart-row";
import type { TreeQueryRow } from "@/features/chart/tree-query";

import { classifyMechanical } from "./classify";
import { diffSeatSnapshots } from "./diff";
import { findHeaderRenames } from "./header-renames";
import type { ChangeType } from "./labels";
import { buildChartSnapshots, type SeatSnapshot } from "./seat-snapshot";

export interface ProspectiveChangeReason {
  nodeId: string;
  automaticType: ChangeType;
  employeeName: string;
  position: string;
}

export function seatPositionLabel(snapshot: SeatSnapshot | null): string {
  if (!snapshot) return "";
  const path = [snapshot.dept, ...snapshot.teamLevels].filter(Boolean).join(" › ");
  return snapshot.jobTitle ? `${snapshot.jobTitle} · ${path}` : path;
}

export function buildProspectiveChangeReasons(
  beforeRows: TreeQueryRow[],
  afterRows: TreeQueryRow[],
): ProspectiveChangeReason[] {
  const { rows: beforeChartRows } = buildChart(beforeRows);
  const { rows: afterChartRows } = buildChart(afterRows);
  const renamedIds = new Set(
    findHeaderRenames(beforeChartRows, afterChartRows).map((rename) => rename.nodeId),
  );
  const before = buildChartSnapshots(beforeRows, new Map());
  const after = buildChartSnapshots(afterRows, new Map());

  return diffSeatSnapshots(before, after, renamedIds)
    .map((pair): ProspectiveChangeReason | null => {
      const automaticType = classifyMechanical(pair.before, pair.after);
      if (!automaticType) return null;
      const snapshot = pair.after ?? pair.before;
      return {
        nodeId: pair.nodeId,
        automaticType,
        employeeName: snapshot?.fullName ?? "Unknown",
        position: seatPositionLabel(snapshot),
      };
    })
    .filter((row): row is ProspectiveChangeReason => row !== null)
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}
