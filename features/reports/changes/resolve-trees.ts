/**
 * Resolve before/after published trees for a KL calendar day.
 */

import "server-only";

import { organizationDayBounds } from "@/features/reports/csv";
import { withDbRetry } from "@/lib/db";

import {
  parseChangeType,
  parseManualChangeReason,
  type ChangeType,
  type ManualChangeReason,
} from "./labels";

export type StoredChangeReasonOverrides = Record<string, ManualChangeReason | null>;

function parseStoredChangeReasonOverrides(
  value: unknown,
): StoredChangeReasonOverrides | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed: StoredChangeReasonOverrides = {};
  for (const [nodeId, reason] of Object.entries(value)) {
    if (reason === null) parsed[nodeId] = null;
    else {
      const manual = parseManualChangeReason(reason);
      if (manual) parsed[nodeId] = manual;
    }
  }
  return Object.keys(parsed).length > 0 ? parsed : null;
}

export interface DayMergeMeta {
  mergeId: string;
  sandboxTreeId: string;
  resultingTreeId: string;
  mergedAt: string;
  mergerAuthId: string;
  publishChangeType: ChangeType | null;
  changeReasonOverrides: StoredChangeReasonOverrides | null;
}

export interface ResolvedDayTrees {
  beforeTreeId: string | null;
  afterTreeId: string | null;
  merges: DayMergeMeta[];
  hasRestore: boolean;
}

export async function resolveDayTrees(dateYmd: string): Promise<ResolvedDayTrees> {
  const { start, end } = organizationDayBounds(dateYmd);

  return withDbRetry(async (sql) => {
    const trees = await sql<
      { tree_id: string; published_at: string | null; kind: string }[]
    >`
      select tree_id, published_at::text, kind
      from organelle.trees
      where kind in ('published', 'historical')
        and published_at is not null
      order by published_at asc
    `;

    let beforeTreeId: string | null = null;
    let afterTreeId: string | null = null;

    for (const tree of trees) {
      const at = new Date(tree.published_at!);
      if (at < start) {
        beforeTreeId = tree.tree_id;
      } else if (at >= start && at < end) {
        afterTreeId = tree.tree_id;
      }
    }

    const merges = await sql<
      {
        merge_id: string;
        sandbox_tree_id: string;
        resulting_tree_id: string | null;
        merged_at: string;
        merger_auth_id: string;
        publish_change_type: string | null;
        change_reason_overrides: unknown;
      }[]
    >`
      select
        m.merge_id,
        m.sandbox_tree_id,
        m.resulting_tree_id,
        m.merged_at::text,
        m.merger_auth_id,
        m.publish_change_type::text,
        m.change_reason_overrides
      from organelle.sandbox_merges m
      where m.status = 'merged'
        and m.merged_at >= ${start.toISOString()}::timestamptz
        and m.merged_at < ${end.toISOString()}::timestamptz
      order by m.merged_at asc
    `;

    const restoreRows = await sql<{ n: number }[]>`
      select count(*)::int as n
      from organelle.change_log cl
      join organelle.trees t on t.tree_id = cl.tree_id
      where cl.op = 'restore_version'
        and cl.created_at >= ${start.toISOString()}::timestamptz
        and cl.created_at < ${end.toISOString()}::timestamptz
    `;

    return {
      beforeTreeId,
      afterTreeId,
      merges: merges
        .filter((m) => m.resulting_tree_id)
        .map((m) => ({
          mergeId: m.merge_id,
          sandboxTreeId: m.sandbox_tree_id,
          resultingTreeId: m.resulting_tree_id!,
          mergedAt: m.merged_at,
          mergerAuthId: m.merger_auth_id,
          publishChangeType: parseChangeType(m.publish_change_type),
          changeReasonOverrides: parseStoredChangeReasonOverrides(
            m.change_reason_overrides,
          ),
        })),
      hasRestore: (restoreRows[0]?.n ?? 0) > 0,
    };
  });
}
