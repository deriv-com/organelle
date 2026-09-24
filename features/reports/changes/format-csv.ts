export const CHANGES_CSV_COLUMNS = [
  "state",
  "seat_id",
  "employee_id",
  "full_name",
  "email",
  "job_title",
  "position_level",
  "manager_employee_id",
  "manager_name",
  "manager_email",
  "change_type",
  "effective_at",
  "organization_path",
  "actor_email",
] as const;

import { formatCsvRow } from "../csv";
import { changeTypeLabel, type ChangeType } from "./labels";
import type { SeatSnapshot } from "./seat-snapshot";

function buildRow(
  side: "Before" | "After",
  s: SeatSnapshot | null,
  changeType: ChangeType,
  effectiveDate: string,
  actorEmail: string,
): string[] {
  const row: string[] = [
    side,
    s?.nodeId ?? "",
    s?.employeeId ?? "",
    s?.fullName ?? "",
    s?.email ?? "",
    s?.jobTitle ?? "",
    s?.positionLevel == null ? "" : String(s.positionLevel),
    s?.managerEmployeeId ?? "",
    s?.managerName ?? "",
    s?.managerEmail ?? "",
    changeTypeLabel(changeType),
    effectiveDate,
    s?.organizationPath ?? "",
    actorEmail,
  ];
  assertChangesColumnCount(row);
  return row;
}

export function formatChangePairCsvRows(args: {
  before: SeatSnapshot | null;
  after: SeatSnapshot | null;
  changeType: ChangeType;
  effectiveDate: string;
  actorEmail?: string;
}): [string[], string[]] {
  return [
    buildRow(
      "Before",
      args.before,
      args.changeType,
      args.effectiveDate,
      args.actorEmail ?? "",
    ),
    buildRow(
      "After",
      args.after,
      args.changeType,
      args.effectiveDate,
      args.actorEmail ?? "",
    ),
  ];
}

export function formatChangesCsv(pairs: Array<[string[], string[]]>): string {
  const header = formatCsvRow([...CHANGES_CSV_COLUMNS]);
  const lines = pairs.flatMap(([before, after]) => [
    formatCsvRow(before),
    formatCsvRow(after),
  ]);
  return [header, ...lines].join("\n");
}

export function assertChangesColumnCount(row: string[]): void {
  if (row.length !== CHANGES_CSV_COLUMNS.length) {
    throw new Error(
      `Expected ${CHANGES_CSV_COLUMNS.length} columns, got ${row.length}`,
    );
  }
}
