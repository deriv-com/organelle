import type { SeatSnapshot } from "./seat-snapshot";

export function employeeDisplayName(
  before: SeatSnapshot | null,
  after: SeatSnapshot | null,
): string {
  return after?.fullName ?? before?.fullName ?? "";
}

export function compareChangeRowsByName(
  a: { before: SeatSnapshot | null; after: SeatSnapshot | null },
  b: { before: SeatSnapshot | null; after: SeatSnapshot | null },
): number {
  return employeeDisplayName(a.before, a.after).localeCompare(
    employeeDisplayName(b.before, b.after),
    undefined,
    { sensitivity: "base" },
  );
}
