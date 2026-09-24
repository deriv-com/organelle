/**
 * Sandbox Add-position catalog mappers. Client-safe: the SQL load
 * lives in employee-picker-query.ts so ChartClient does not pull postgres/`net`.
 */

import { shouldMuteServingNotice, type SeatMember } from "./chart-row";
import type { EmployeeOption } from "./drag/add-node-dialog";

export interface PickerEmployeeRow {
  auth_id: string;
  full_name: string | null;
  email: string | null;
  job_title: string | null;
  avatar_url: string | null;
  office_location: string | null;
  status: SeatMember["status"];
  joining_date: string | null;
  position_level: number | null;
  override_auth_id: string | null;
  display_name: string | null;
  display_title: string | null;
  override_avatar_url: string | null;
  override_status: SeatMember["status"] | null;
  override_position_level: number | null;
}

export function toSeatMember(row: PickerEmployeeRow): SeatMember {
  const hasOverride = row.override_auth_id != null;
  const status = hasOverride
    ? (row.override_status ?? "active")
    : (row.status ?? "active");
  const positionLevel = hasOverride ? row.override_position_level : row.position_level;
  return {
    authId: row.auth_id,
    displayName: row.display_name ?? row.full_name ?? "Unknown",
    displayTitle: row.display_title ?? row.job_title ?? "",
    email: row.email ?? "",
    avatarUrl: row.override_avatar_url ?? row.avatar_url,
    officeLocation: row.office_location ?? "",
    status,
    joiningDate: row.joining_date,
    positionLevel,
    servingNoticeMuted: shouldMuteServingNotice(status, positionLevel),
    isHost: true,
    sourceName: row.full_name ?? "Unknown",
    sourceTitle: row.job_title ?? "",
    sourceAvatarUrl: row.avatar_url,
    overrideName: row.display_name,
    overrideTitle: row.display_title,
    overrideAvatarUrl: row.override_avatar_url,
  };
}

export function mapPickerRows(rows: PickerEmployeeRow[]): SeatMember[] {
  return rows
    .map(toSeatMember)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function toEmployeeOption(member: SeatMember): EmployeeOption {
  return {
    authId: member.authId,
    displayName: member.displayName,
    displayTitle: member.displayTitle,
    status: member.status,
  };
}
