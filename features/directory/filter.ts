/**
 * Directory filtering, sorting, and search. All client-side over the
 * in-memory tree payload — no server round trips. 1000 seats must filter in
 * single-digit milliseconds; the perf test guards that.
 */

import { personSearchTokenMatches } from "@/lib/people-search";

import type { SeatMember } from "../chart/chart-row";
import type { DirectoryRow } from "./directory-row";

export interface DirectoryFilters {
  /** Show only seats beneath this header node id. */
  headerId: string | null;
  offices: string[];
  statuses: Array<SeatMember["status"]>;
  hasPeers: boolean;
  multiRole: boolean;
  /** Free text over name, email, team path. Every word must match. */
  text: string;
}

export const EMPTY_FILTERS: DirectoryFilters = {
  headerId: null,
  offices: [],
  statuses: [],
  hasPeers: false,
  multiRole: false,
  text: "",
};

export function applyFilters(
  rows: DirectoryRow[],
  filters: DirectoryFilters,
): DirectoryRow[] {
  const words = filters.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (filters.headerId && !row.headerPathIds.includes(filters.headerId)) return false;
    if (
      filters.offices.length > 0 &&
      !filters.offices.includes(row.host.officeLocation)
    ) {
      return false;
    }
    if (filters.statuses.length > 0 && !filters.statuses.includes(row.host.status))
      return false;
    if (filters.hasPeers && row.peers < 2) return false;
    if (filters.multiRole && !row.multiRole) return false;
    if (words.length > 0) {
      if (
        !words.every((word) =>
          personSearchTokenMatches(
            word,
            [row.host.displayName, row.teamPath],
            row.host.email,
          ),
        )
      ) {
        return false;
      }
    }
    return true;
  });
}

export type SortKey = "name" | "teamPath" | "location";

const COLLATOR = new Intl.Collator("en", { sensitivity: "base" });

/** Stable secondary sort on name. */
export function sortRows(
  rows: DirectoryRow[],
  key: SortKey,
  dir: "asc" | "desc" = "asc",
): DirectoryRow[] {
  const sign = dir === "desc" ? -1 : 1;
  const primary = (row: DirectoryRow): string => {
    switch (key) {
      case "name":
        return row.host.displayName;
      case "teamPath":
        return row.teamPath;
      case "location":
        return row.host.officeLocation;
    }
  };
  return [...rows].sort((a, b) => {
    const byKey = COLLATOR.compare(primary(a), primary(b));
    if (byKey !== 0) return sign * byKey;
    return COLLATOR.compare(a.host.displayName, b.host.displayName);
  });
}

/** Distinct office locations, sorted — for the office filter options. */
export function officeOptions(rows: DirectoryRow[]): string[] {
  return [
    ...new Set(rows.map((row) => row.host.officeLocation).filter(Boolean)),
  ].sort();
}
