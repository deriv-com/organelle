/**
 * CSV labels for change_type enum.
 */

export type ChangeType =
  | "manager_change"
  | "team_level_restructure_change"
  | "internal_movement"
  | "new_hire"
  | "seat_removed"
  | "peer_change"
  | "sandbox_merge"
  | "snapshot_restore"
  | "org_chart_change"
  | "promotion_change"
  | "demotion"
  | "job_title_change"
  | "level_change"
  | "position_level_change";

export const MANUAL_CHANGE_REASON_VALUES = [
  "promotion_change",
  "demotion",
  "job_title_change",
  "level_change",
  "position_level_change",
] as const;

export type ManualChangeReason = (typeof MANUAL_CHANGE_REASON_VALUES)[number];

const MANUAL_CHANGE_REASON_SET = new Set<string>(MANUAL_CHANGE_REASON_VALUES);

export const CHANGE_TYPE_LABEL: Record<ChangeType, string> = {
  manager_change: "Manager Change",
  team_level_restructure_change: "Team Level / Restructure Change",
  internal_movement: "Internal Movement Change",
  new_hire: "New Hire",
  seat_removed: "Position Removed",
  peer_change: "Peer Change",
  sandbox_merge: "Sandbox merge",
  snapshot_restore: "Snapshot Restore",
  org_chart_change: "Org Chart Change",
  promotion_change: "Promotion Change",
  demotion: "Demotion",
  job_title_change: "Job Title Change",
  level_change: "Level Change",
  position_level_change: "Position Level Change",
};

export function changeTypeLabel(type: ChangeType): string {
  return CHANGE_TYPE_LABEL[type];
}

export function parseChangeType(value: string | null | undefined): ChangeType | null {
  if (!value) return null;
  return value in CHANGE_TYPE_LABEL ? (value as ChangeType) : null;
}

export function parseManualChangeReason(value: unknown): ManualChangeReason | null {
  return typeof value === "string" && MANUAL_CHANGE_REASON_SET.has(value)
    ? (value as ManualChangeReason)
    : null;
}

export function canOverrideChangeReason(type: ChangeType): boolean {
  return (
    type === "manager_change" ||
    type === "team_level_restructure_change" ||
    type === "internal_movement"
  );
}
