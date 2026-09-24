/**
 * Sandbox unplaced list: joining/active people with zero seats in the
 * open sandbox tree. Client-derived from the picker catalog and live ChartRows —
 * separate from the full directory.
 */

import type { ChartRow, SeatMember } from "./chart-row";

export interface UnplacedPerson {
  authId: string;
  displayName: string;
  displayTitle: string;
}

const PLACEABLE: ReadonlySet<SeatMember["status"]> = new Set(["joining", "active"]);

export function listUnplacedEmployees(
  catalog: SeatMember[],
  rows: ChartRow[],
): UnplacedPerson[] {
  const placed = new Set<string>();
  for (const row of rows) {
    for (const member of row.members) {
      placed.add(member.authId);
    }
  }

  return catalog
    .filter((person) => PLACEABLE.has(person.status) && !placed.has(person.authId))
    .map((person) => ({
      authId: person.authId,
      displayName: person.displayName,
      displayTitle: person.displayTitle,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
