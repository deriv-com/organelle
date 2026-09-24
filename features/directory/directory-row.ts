/**
 * Directory row builder.
 *
 * Occupied seats: one row per seat. Resigned people with no seat: synthetic rows
 * for publisher / admin / publisher (nodeId empty).
 */

import {
  hydratePublicMember,
  toPublicMember,
  type ChartRow,
  type PublicSeatMember,
  type SeatMember,
} from "../chart/chart-row";

export interface DirectoryRow {
  nodeId: string;
  host: SeatMember;
  /** Seat's own job title, falling back to the host's. */
  jobTitle: string;
  /** Ancestor header names, root-ward: "Compliance › Regulatory › Malaysia". */
  teamPath: string;
  /** Ancestor header node ids — powers the header-subtree filter. */
  headerPathIds: string[];
  /** Host of the nearest ancestor seat; "" for the root seat. */
  manager: string;
  /** Co-assignees on the same seat (1 = no peers). */
  peers: number;
  /** Host holds 2+ seats anywhere in the tree. */
  multiRole: boolean;
}

/** Exact row DTO shipped by the published directory stream. */
export interface PublicDirectoryRow {
  nodeId: string;
  host: PublicSeatMember;
  teamPath: string;
  headerPathIds: string[];
  manager: string;
  peers: number;
  multiRole: boolean;
}

export function toPublicDirectoryRows(rows: DirectoryRow[]): PublicDirectoryRow[] {
  return rows.map((row) => ({
    nodeId: row.nodeId,
    host: toPublicMember(row.host),
    teamPath: row.teamPath,
    headerPathIds: row.headerPathIds,
    manager: row.manager,
    peers: row.peers,
    multiRole: row.multiRole,
  }));
}

export function hydratePublicDirectoryRows(rows: PublicDirectoryRow[]): DirectoryRow[] {
  return rows.map((row) => ({
    nodeId: row.nodeId,
    host: hydratePublicMember(row.host),
    jobTitle: "",
    teamPath: row.teamPath,
    headerPathIds: row.headerPathIds,
    manager: row.manager,
    peers: row.peers,
    multiRole: row.multiRole,
  }));
}

export function buildDirectoryRows(rows: ChartRow[]): DirectoryRow[] {
  // Callers pass rows already validated by indexFromRows; parent lookup via map.
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  const seatsPerAuthId = new Map<string, number>();
  for (const row of rows) {
    for (const member of row.members) {
      seatsPerAuthId.set(member.authId, (seatsPerAuthId.get(member.authId) ?? 0) + 1);
    }
  }

  const result: DirectoryRow[] = [];
  for (const row of rows) {
    if (row.kind !== "seat" || row.members.length === 0) continue;
    const host = row.members[0]!;

    const headerNames: string[] = [];
    const headerPathIds: string[] = [];
    let manager = "";
    let cursor = row.parentId;
    while (cursor !== "") {
      const parent = rowsById.get(cursor);
      if (!parent) break; // unreachable — indexFromRows already validated
      if (parent.kind === "header") {
        headerNames.unshift(parent.name ?? "");
        headerPathIds.unshift(parent.id);
      } else if (manager === "" && parent.members.length > 0) {
        manager = parent.members[0]!.displayName;
      }
      cursor = parent.parentId;
    }

    result.push({
      nodeId: row.id,
      host,
      jobTitle: row.jobTitle ?? host.displayTitle,
      teamPath: headerNames.join(" › "),
      headerPathIds,
      manager,
      peers: row.members.length,
      multiRole: (seatsPerAuthId.get(host.authId) ?? 0) >= 2,
    });
  }
  return result;
}

export function resignedDirectoryRow(host: SeatMember, teamPath: string): DirectoryRow {
  return {
    nodeId: "",
    host,
    jobTitle: host.displayTitle,
    teamPath: teamPath.trim() ? teamPath : "—",
    headerPathIds: [],
    manager: "",
    peers: 1,
    multiRole: false,
  };
}
