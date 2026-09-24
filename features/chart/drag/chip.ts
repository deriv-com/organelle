/**
 * Cursor-chip copy during a drag.
 */

import type { ChartRow } from "../chart-row";
import type { Zone } from "./zone";

function rowLabel(row: ChartRow | undefined): string {
  if (!row) return "node";
  if (row.kind === "header") return row.name ?? "team";
  return row.members[0]?.displayName ?? row.jobTitle ?? "seat";
}

export function chipText(
  zone: Zone,
  valid: boolean,
  reason: string | null,
  dragged: ChartRow | undefined,
  target: ChartRow | undefined,
  memberAuthId?: string | null,
): string {
  if (!valid) return reason ?? "Can't drop here";
  const member = memberAuthId
    ? dragged?.members.find((m) => m.authId === memberAuthId)
    : undefined;
  const from = member?.displayName ?? rowLabel(dragged);
  const to = rowLabel(target);
  switch (zone.zone) {
    case "child":
      return `Move ${from} under ${to}`;
    case "peer":
      return `Move ${from} as peer of ${to}`;
    case "sibling-before":
      return `Place ${from} before ${to}`;
    case "sibling-after":
      return `Place ${from} after ${to}`;
    default:
      return "Can't drop here";
  }
}
