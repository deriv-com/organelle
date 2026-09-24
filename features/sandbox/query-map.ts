import type { SandboxSummary } from "./types";

export interface SandboxSummaryRow {
  tree_id: string;
  name: string;
  created_at: string;
  forked_from_seq: number;
  change_count: number;
  owner_auth_id: string;
  live_seq: number | null;
  archived_at: string | null;
}

export function mapSandboxSummary(row: SandboxSummaryRow): SandboxSummary {
  return {
    treeId: row.tree_id,
    name: row.name,
    createdAt: row.created_at,
    forkedFromSeq: row.forked_from_seq,
    changeCount: row.change_count,
    ownerAuthId: row.owner_auth_id,
    liveSeq: row.live_seq,
    isStale: typeof row.live_seq === "number" && row.forked_from_seq < row.live_seq,
    archived: row.archived_at !== null,
  };
}
