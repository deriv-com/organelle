/**
 * Normalized seat state for change-report diffing.
 */

import { buildChart, type ChartRow } from "@/features/chart/chart-row";

export interface SeatSnapshot {
  nodeId: string;
  parentNodeId: string;
  parentSeatId: string;
  sortOrder: number;
  jobTitle: string;
  positionLevel?: number | null;
  memberAuthIds: string[];
  hostAuthId: string | null;
  employeeId: string;
  employmentRecord: string;
  fullName: string;
  email: string;
  status: string;
  managerEmail: string;
  managerName: string;
  managerEmployeeId?: string;
  headerPathIds: string[];
  dept: string;
  teamLevels: [string, string, string, string, string, string, string];
  organizationPath?: string;
}

export interface EmployeeReportFields {
  id: string | null;
  employmentRecord?: string | null;
}

function splitPath(headerNames: string[]): {
  dept: string;
  teamLevels: SeatSnapshot["teamLevels"];
} {
  const padded = [...headerNames, "", "", "", "", "", "", ""];
  const dept = padded[0] ?? "";
  return {
    dept,
    teamLevels: [
      padded[1] ?? "",
      padded[2] ?? "",
      padded[3] ?? "",
      padded[4] ?? "",
      padded[5] ?? "",
      padded[6] ?? "",
      padded[7] ?? "",
    ],
  };
}

export function buildSeatSnapshots(
  rows: ChartRow[],
  employeeFields: Map<string, EmployeeReportFields>,
): Map<string, SeatSnapshot> {
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, SeatSnapshot>();

  for (const row of rows) {
    if (row.kind !== "seat") continue;

    const headerNames: string[] = [];
    const headerPathIds: string[] = [];
    let parentSeatId = "";
    let managerName = "";
    let managerEmail = "";
    let managerEmployeeId = "";
    let cursor = row.parentId;

    while (cursor !== "") {
      const parent = rowsById.get(cursor);
      if (!parent) break;
      if (parent.kind === "header") {
        headerNames.unshift(parent.name ?? "");
        headerPathIds.unshift(parent.id);
      } else if (parentSeatId === "" && parent.members.length > 0) {
        parentSeatId = parent.id;
        const mgr = parent.members[0]!;
        managerName = mgr.displayName;
        managerEmail = mgr.email;
        managerEmployeeId = mgr.employeeId ?? mgr.authId;
      }
      cursor = parent.parentId;
    }

    const host = row.members[0];
    const fields = host ? employeeFields.get(host.authId) : undefined;
    const { dept, teamLevels } = splitPath(headerNames);
    const memberAuthIds = row.members.map((m) => m.authId).sort();

    out.set(row.id, {
      nodeId: row.id,
      parentNodeId: row.parentId,
      parentSeatId,
      sortOrder: row.sortOrder,
      jobTitle: row.jobTitle ?? host?.displayTitle ?? "",
      positionLevel: row.positionLevel ?? host?.positionLevel ?? null,
      memberAuthIds,
      hostAuthId: host?.authId ?? null,
      employeeId: fields?.id ?? "",
      employmentRecord: fields?.employmentRecord ?? "",
      fullName: host?.displayName ?? "",
      email: host?.email ?? "",
      status: host?.status ?? "",
      managerEmail,
      managerName,
      managerEmployeeId,
      headerPathIds,
      dept,
      teamLevels,
      organizationPath: [dept, ...teamLevels].filter(Boolean).join(" > "),
    });
  }

  return out;
}

export function buildChartSnapshots(
  queryRows: import("@/features/chart/tree-query").TreeQueryRow[],
  employeeFields: Map<string, EmployeeReportFields>,
): Map<string, SeatSnapshot> {
  const { rows } = buildChart(queryRows);
  return buildSeatSnapshots(rows, employeeFields);
}

export function pathKey(s: SeatSnapshot): string {
  return [s.dept, ...s.teamLevels].join("\0");
}

export function snapshotsEqual(a: SeatSnapshot, b: SeatSnapshot): boolean {
  return (
    a.parentSeatId === b.parentSeatId &&
    pathKey(a) === pathKey(b) &&
    a.sortOrder === b.sortOrder &&
    a.jobTitle === b.jobTitle &&
    a.memberAuthIds.join(",") === b.memberAuthIds.join(",")
  );
}

export function headerPathIdsEqual(a: SeatSnapshot, b: SeatSnapshot): boolean {
  return a.headerPathIds.join(",") === b.headerPathIds.join(",");
}
