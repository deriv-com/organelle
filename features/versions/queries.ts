import "server-only";

import { withDbRetry } from "@/lib/db";

import { formatMergeCounts, type MergeCounts, type PublishedKind } from "./policy";
import type { VersionSummary } from "./types";

/**
 * Query-only helper for `/versions`, whose page is already restore-role gated by
 * `app/layout.tsx`. Use `listVersions()` from actions for any ungated caller.
 */
export async function listVersionsForAdminPage(): Promise<VersionSummary[]> {
  return withDbRetry(async (sql) => {
    const rows = await sql<
      {
        tree_id: string;
        kind: PublishedKind;
        version_seq: number;
        published_at: string | null;
        title: string | null;
        merger_name: string | null;
        counts: MergeCounts | null;
      }[]
    >`
      select
        t.tree_id,
        t.kind,
        t.version_seq,
        t.published_at::text,
        m.title,
        coalesce(merger.full_name, creator.full_name) as merger_name,
        m.counts
      from organelle.trees t
      left join organelle.sandbox_merges m
        on m.resulting_tree_id = t.tree_id and m.status = 'merged'
      left join organelle.employees merger
        on merger.auth_id = m.merger_auth_id
      left join organelle.employees creator
        on creator.auth_id = t.created_by_auth_id
      where t.kind in ('published', 'historical')
        and t.version_seq is not null
      order by t.version_seq desc
    `;
    return rows.map((row) => ({
      treeId: row.tree_id,
      kind: row.kind,
      versionSeq: Number(row.version_seq),
      publishedAt: row.published_at,
      title:
        row.title ??
        (Number(row.version_seq) === 1 ? "Initial publish" : "Restored version"),
      mergerName: row.merger_name,
      countsLabel: formatMergeCounts(row.counts),
      live: row.kind === "published",
    }));
  });
}
