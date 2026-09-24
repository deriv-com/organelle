/**
 * Orchestrates the daily change report.
 */

import "server-only";

import { buildChart } from "@/features/chart/chart-row";
import { fetchTreeRows, type TreeQueryRow } from "@/features/chart/tree-query";
import { formatOrganizationTimestamp } from "@/features/reports/csv";
import { withDbRetry } from "@/lib/db";

import { fetchMergerNames, fetchSeatActors } from "./attribution";
import { classifyMechanical, resolveSeatChangeType } from "./classify";
import { diffSeatSnapshots } from "./diff";
import {
  assertChangesColumnCount,
  formatChangePairCsvRows,
  formatChangesCsv,
} from "./format-csv";
import { findHeaderRenames } from "./header-renames";
import { changeTypeLabel, type ChangeType } from "./labels";
import { seatPositionLabel } from "./prospective";
import { resolveDayTrees } from "./resolve-trees";
import { compareChangeRowsByName } from "./sort-rows";
import {
  buildChartSnapshots,
  type EmployeeReportFields,
  type SeatSnapshot,
} from "./seat-snapshot";

export interface InAppChangeRow {
  nodeId: string;
  changeType: ChangeType;
  changeTypeLabel: string;
  before: SeatSnapshot | null;
  after: SeatSnapshot | null;
  actorName: string;
  position: string;
  effectiveDate: string;
}

export interface ChangesReportResult {
  date: string;
  csv: string;
  rows: InAppChangeRow[];
  headerRenames: ReturnType<typeof findHeaderRenames>;
  empty: boolean;
}

async function fetchEmployeeReportFields(
  authIds: string[],
): Promise<Map<string, EmployeeReportFields>> {
  if (authIds.length === 0) return new Map();
  return withDbRetry(async (sql) => {
    const rows = await sql<{ auth_id: string; id: string | null }[]>`
      select auth_id, id
      from organelle.employees
      where auth_id = any(${authIds}::uuid[])
    `;
    return new Map(rows.map((r) => [r.auth_id, { id: r.id }]));
  });
}

function collectAuthIds(rows: TreeQueryRow[]): string[] {
  return [
    ...new Set(rows.flatMap((r) => (r.employee_auth_id ? [r.employee_auth_id] : []))),
  ];
}

export async function buildChangesReport(
  dateYmd: string,
): Promise<ChangesReportResult> {
  const resolved = await resolveDayTrees(dateYmd);

  if (!resolved.afterTreeId) {
    return {
      date: dateYmd,
      csv: formatChangesCsv([]),
      rows: [],
      headerRenames: [],
      empty: true,
    };
  }

  const beforeRows = resolved.beforeTreeId
    ? await fetchTreeRows(resolved.beforeTreeId)
    : [];
  const afterRows = await fetchTreeRows(resolved.afterTreeId);

  const authIds = [
    ...new Set([...collectAuthIds(beforeRows), ...collectAuthIds(afterRows)]),
  ];
  const employeeFields = await fetchEmployeeReportFields(authIds);

  const beforeSnaps = resolved.beforeTreeId
    ? buildChartSnapshots(beforeRows, employeeFields)
    : new Map<string, SeatSnapshot>();
  const afterSnaps = buildChartSnapshots(afterRows, employeeFields);

  const { rows: beforeChartRows } = buildChart(beforeRows);
  const { rows: afterChartRows } = buildChart(afterRows);
  const headerRenames = findHeaderRenames(beforeChartRows, afterChartRows);
  const renamedIds = new Set(headerRenames.map((h) => h.nodeId));

  const pairs = diffSeatSnapshots(beforeSnaps, afterSnaps, renamedIds).sort(
    compareChangeRowsByName,
  );

  const lastMerge = resolved.merges.at(-1);
  const effectiveIso =
    lastMerge?.mergedAt ??
    (await withDbRetry(async (sql) => {
      const t = await sql<{ published_at: string }[]>`
        select published_at::text from organelle.trees
        where tree_id = ${resolved.afterTreeId}
      `;
      return t[0]?.published_at ?? new Date().toISOString();
    }));
  const effectiveDate = formatOrganizationTimestamp(effectiveIso);

  const mergerIds = resolved.merges.map((m) => m.mergerAuthId);
  const mergerNames = await fetchMergerNames(mergerIds);
  const mergerBySandbox = new Map(
    resolved.merges.map((m) => [
      m.sandboxTreeId,
      {
        authId: m.mergerAuthId,
        ...(mergerNames.get(m.mergerAuthId) ?? { name: "Unknown", email: "" }),
      },
    ]),
  );

  const actors = await fetchSeatActors({
    nodeIds: pairs.map((p) => p.nodeId),
    sandboxTreeIds: resolved.merges.map((m) => m.sandboxTreeId),
    mergerBySandbox,
  });

  const csvPairs: Array<[string[], string[]]> = [];
  const inAppRows: InAppChangeRow[] = [];

  for (const pair of pairs) {
    const changeType = resolveSeatChangeType({
      nodeId: pair.nodeId,
      mechanical: classifyMechanical(pair.before, pair.after),
      hasRestore: resolved.hasRestore,
      merges: resolved.merges,
    });
    if (!changeType) continue;

    const csvPair = formatChangePairCsvRows({
      before: pair.before,
      after: pair.after,
      changeType,
      effectiveDate,
      actorEmail: actors.get(pair.nodeId)?.email ?? "",
    });
    csvPairs.push(csvPair);
    assertChangesColumnCount(csvPair[0]!);
    assertChangesColumnCount(csvPair[1]!);

    const actor = actors.get(pair.nodeId);
    inAppRows.push({
      nodeId: pair.nodeId,
      changeType,
      changeTypeLabel: changeTypeLabel(changeType),
      before: pair.before,
      after: pair.after,
      actorName: actor?.name ?? "Unknown",
      position: seatPositionLabel(pair.after ?? pair.before),
      effectiveDate,
    });
  }

  return {
    date: dateYmd,
    csv: formatChangesCsv(csvPairs),
    rows: inAppRows,
    headerRenames,
    empty: csvPairs.length === 0,
  };
}
