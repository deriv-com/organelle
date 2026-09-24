import type { ChartRow } from "./chart-row";

export function showHostBadge(seatMemberCount: number): boolean {
  return seatMemberCount >= 2;
}

export function showPrimaryChrome(personSeatCount: number): boolean {
  return personSeatCount >= 2;
}

export function seatChrome(args: {
  personSeatCount: number;
  seatMemberCount: number;
  isPrimary: boolean;
  isHost: boolean;
}): { primary?: "Primary" | "Secondary"; host?: "Host" | "Peer" } {
  return {
    ...(showPrimaryChrome(args.personSeatCount)
      ? { primary: args.isPrimary ? "Primary" : "Secondary" }
      : {}),
    ...(showHostBadge(args.seatMemberCount)
      ? { host: args.isHost ? "Host" : "Peer" }
      : {}),
  };
}

export function canEditPersonFields(args: {
  treeKind: string | null;
  canEdit: boolean;
}): boolean {
  return args.treeKind === "sandbox" && args.canEdit;
}

export function primaryDenorm(
  rows: ChartRow[],
  primaryNodeId: string,
): { managerAuthId: string | null; teamPath: string } {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const start = byId.get(primaryNodeId);
  if (!start) return { managerAuthId: null, teamPath: "" };

  let managerAuthId: string | null = null;
  const headers: string[] = [];
  let cursor = start.parentId;
  while (cursor) {
    const node = byId.get(cursor);
    if (!node) break;
    if (node.kind === "header" && node.name) headers.push(node.name);
    if (managerAuthId == null && node.kind === "seat") {
      const host = node.members.find((member) => member.isHost) ?? node.members[0];
      managerAuthId = host?.authId ?? null;
    }
    cursor = node.parentId;
  }
  return { managerAuthId, teamPath: headers.reverse().join(" › ") };
}

export function restorePrimaries(rows: ChartRow[]): ChartRow[] {
  const seatsByPerson = new Map<string, string[]>();
  for (const row of rows) {
    for (const member of row.members) {
      const list = seatsByPerson.get(member.authId) ?? [];
      list.push(row.id);
      seatsByPerson.set(member.authId, list);
    }
  }
  const promote = new Set<string>();
  for (const [authId, nodeIds] of seatsByPerson) {
    const hasPrimary = nodeIds.some((nodeId) =>
      rows
        .find((row) => row.id === nodeId)
        ?.members.some((member) => member.authId === authId && member.isPrimary),
    );
    if (!hasPrimary && nodeIds[0]) promote.add(`${nodeIds[0]}:${authId}`);
  }
  if (promote.size === 0) return rows;
  return rows.map((row) => ({
    ...row,
    members: row.members.map((member) =>
      promote.has(`${row.id}:${member.authId}`)
        ? { ...member, isPrimary: true }
        : member,
    ),
  }));
}

export function isFirstSeatForPerson(rows: ChartRow[], authId: string): boolean {
  return !rows.some((row) => row.members.some((member) => member.authId === authId));
}
