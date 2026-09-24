import {
  DIRECTORY_STATUS_ROLES,
  hasAllowedRole,
  type AppRole,
} from "@/features/auth/policy";
type VisibleDirectoryRow = {
  host: { authId: string; status: string };
};

export function canSeeDirectoryStatus(role: AppRole): boolean {
  return hasAllowedRole(role, DIRECTORY_STATUS_ROLES);
}

export function filterDirectoryRowsForRole<T extends VisibleDirectoryRow>(
  rows: T[],
  role: AppRole,
): T[] {
  if (canSeeDirectoryStatus(role)) return rows;
  return rows.filter((row) => row.host.status !== "resigned");
}

export function mergeResignedRows<T extends VisibleDirectoryRow>(
  seatRows: T[],
  resignedRows: T[],
): T[] {
  const seated = new Set(seatRows.map((row) => row.host.authId));
  return [...seatRows, ...resignedRows.filter((row) => !seated.has(row.host.authId))];
}
