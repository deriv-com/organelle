/**
 * Chart canvas search index. Filled seats (any assignee) and
 * team headers. Vacant seats omitted. Client-only over the loaded tree.
 */

import { personSearchTokenMatches } from "@/lib/people-search";

import type { ChartRow, SeatMember } from "./chart-row";

export type ChartSearchHit = {
  nodeId: string;
  kind: "header" | "seat";
  title: string;
  subtitle: string;
  avatarUrl: string | null;
  dept: string | null;
};

type RankedHit = ChartSearchHit & { rank: number };

function ancestorHeaderPath(
  rowsById: Map<string, ChartRow>,
  startParentId: string,
): string {
  const names: string[] = [];
  let cursor = startParentId;
  while (cursor !== "") {
    const parent = rowsById.get(cursor);
    if (!parent) break;
    if (parent.kind === "header") names.unshift(parent.name ?? "");
    cursor = parent.parentId;
  }
  return names.join(" › ");
}

/** Colour-family header node_id (depth-2), or null for the root family. */
export function topDeptId(
  rowsById: Map<string, ChartRow>,
  nodeId: string,
): string | null {
  let cursor = rowsById.get(nodeId);
  let lastHeader: ChartRow | null = null;
  while (cursor) {
    if (cursor.kind === "header") lastHeader = cursor;
    if (!cursor.parentId) break;
    cursor = rowsById.get(cursor.parentId);
  }
  return lastHeader && lastHeader.parentId !== "" ? lastHeader.id : null;
}

function wordsOf(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function matches(haystack: string, words: string[]): boolean {
  const hay = haystack.toLowerCase();
  return words.every((word) => hay.includes(word));
}

function memberMatchesToken(
  member: SeatMember,
  word: string,
  includeJobTitle: boolean,
): boolean {
  return personSearchTokenMatches(
    word,
    includeJobTitle ? [member.displayName, member.displayTitle] : [member.displayName],
    member.email,
  );
}

function matchingMember(
  row: ChartRow,
  words: string[],
  includeJobTitle: boolean,
): SeatMember {
  const host = row.members[0]!;
  return (
    row.members.find((member) =>
      words.every((word) => memberMatchesToken(member, word, includeJobTitle)),
    ) ?? host
  );
}

export function searchChart(
  rows: ChartRow[],
  query: string,
  options?: { includeJobTitle?: boolean },
): ChartSearchHit[] {
  const words = wordsOf(query);
  if (words.length === 0) return [];
  const includeJobTitle = options?.includeJobTitle === true;

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const hits: RankedHit[] = [];

  for (const row of rows) {
    const teamPath = ancestorHeaderPath(rowsById, row.parentId);

    if (row.kind === "header") {
      const name = row.name ?? "";
      if (!matches(`${name}\n${teamPath}`, words)) continue;
      hits.push({
        nodeId: row.id,
        kind: "header",
        title: name,
        subtitle: teamPath ? `Team · ${teamPath}` : "Team",
        avatarUrl: null,
        dept: topDeptId(rowsById, row.id),
        rank: matches(name, words) ? 0 : 1,
      });
      continue;
    }

    if (row.members.length === 0) continue;
    const jobTitle = row.jobTitle ?? row.members[0]!.displayTitle;
    const memberMatch = words.every((word) =>
      row.members.some((member) => memberMatchesToken(member, word, includeJobTitle)),
    );
    const seatMatch = words.every(
      (word) =>
        row.members.some((member) =>
          memberMatchesToken(member, word, includeJobTitle),
        ) ||
        (includeJobTitle && jobTitle.toLowerCase().includes(word)),
    );
    if (!seatMatch) continue;
    const person = matchingMember(row, words, includeJobTitle);
    hits.push({
      nodeId: row.id,
      kind: "seat",
      title: person.displayName,
      subtitle: includeJobTitle
        ? teamPath
          ? `${jobTitle} · ${teamPath}`
          : jobTitle
        : teamPath || "",
      avatarUrl: person.avatarUrl,
      dept: topDeptId(rowsById, row.id),
      rank: memberMatch ? 0 : 1,
    });
  }

  hits.sort((a, b) => {
    const kind = (a.kind === "seat" ? 0 : 1) - (b.kind === "seat" ? 0 : 1);
    return kind || a.rank - b.rank || a.title.localeCompare(b.title);
  });
  return hits.map((hit) => ({
    nodeId: hit.nodeId,
    kind: hit.kind,
    title: hit.title,
    subtitle: hit.subtitle,
    avatarUrl: hit.avatarUrl,
    dept: hit.dept,
  }));
}
