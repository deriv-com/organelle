import type { ChartRow, SeatMember } from "../chart/chart-row";
import { formatCsvRow } from "./csv";

export const SEAT_EXPORT_COLUMNS = [
  "seat_id",
  "employee_id",
  "full_name",
  "email",
  "is_host",
  "is_primary",
  "status",
  "job_title",
  "position_level",
  "organization_path",
  "manager_employee_id",
  "manager_name",
  "manager_email",
  "office_location",
  "office_country",
] as const;

export type SeatExportRow = {
  seatId: string;
  employeeId: string;
  member: SeatMember;
  jobTitle: string;
  positionLevel: number | null;
  organizationPath: string;
  managerEmployeeId: string;
  managerName: string;
  managerEmail: string;
};

export function buildSeatExportRows(rows: ChartRow[]): SeatExportRow[] {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const output: SeatExportRow[] = [];
  for (const row of rows) {
    if (row.kind !== "seat") continue;
    const path: string[] = [];
    let manager: SeatMember | undefined;
    let cursor = row.parentId;
    while (cursor) {
      const parent = rowsById.get(cursor);
      if (!parent) break;
      if (parent.kind === "header") path.unshift(parent.name ?? "");
      else if (!manager)
        manager = parent.members.find((member) => member.isHost) ?? parent.members[0];
      cursor = parent.parentId;
    }
    for (const member of row.members) {
      output.push({
        seatId: row.id,
        employeeId: member.employeeId ?? member.authId,
        member,
        jobTitle: row.jobTitle ?? member.displayTitle,
        positionLevel: row.positionLevel ?? member.positionLevel ?? null,
        organizationPath: path.filter(Boolean).join(" > "),
        managerEmployeeId: manager?.employeeId ?? manager?.authId ?? "",
        managerName: manager?.displayName ?? "",
        managerEmail: manager?.email ?? "",
      });
    }
  }
  return output.sort((a, b) =>
    a.member.displayName.localeCompare(b.member.displayName, undefined, {
      sensitivity: "base",
    }),
  );
}

export function seatExportRowToCells(row: SeatExportRow): string[] {
  return [
    row.seatId,
    row.employeeId,
    row.member.displayName,
    row.member.email,
    String(row.member.isHost),
    String(row.member.isPrimary ?? false),
    row.member.status,
    row.jobTitle,
    row.positionLevel == null ? "" : String(row.positionLevel),
    row.organizationPath,
    row.managerEmployeeId,
    row.managerName,
    row.managerEmail,
    row.member.officeLocation,
    row.member.officeCountry ?? "",
  ];
}

export function formatSeatExportCsv(rows: SeatExportRow[]): string {
  return [
    formatCsvRow([...SEAT_EXPORT_COLUMNS]),
    ...rows.map((row) => formatCsvRow(seatExportRowToCells(row))),
  ].join("\n");
}
