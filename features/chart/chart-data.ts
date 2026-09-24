import { buildChart, toPublicChartRows, type PublicChartRow } from "./chart-row";
import {
  fetchPublishedTreeMetadata,
  fetchTreeRows,
  type PublishedTreeMeta,
  type TreePayload,
} from "./tree-query";
import { fetchEmployeeLifecycleCacheKey } from "@/features/employees/status-lifecycle.server";
import { withDbRetry } from "@/lib/db";
import type postgres from "postgres";

export interface PublishedChartSnapshot {
  treeId: string;
  versionSeq: number;
  publishedAt: string | null;
  rows: PublicChartRow[];
}

interface CachedPublishedChartSnapshot {
  meta: PublishedTreeMeta;
  overridesUpdatedAt: string | null;
  employeeLifecycleCacheKey: string;
  snapshot: PublishedChartSnapshot;
}

let publishedChartCache: CachedPublishedChartSnapshot | null = null;
// Per-replica module cache; invalidates on version_seq / override / lifecycle key change (Q11).

export function buildChartSnapshot(payload: TreePayload): PublishedChartSnapshot {
  return {
    treeId: payload.treeId,
    versionSeq: payload.versionSeq,
    publishedAt: payload.publishedAt,
    rows: toPublicChartRows(buildChart(payload.rows).rows),
  };
}

export function clearPublishedChartSnapshotCache() {
  publishedChartCache = null;
}

export function getCachedPublishedChartSnapshot(
  meta: PublishedTreeMeta,
  overridesUpdatedAt: string | null,
  employeeLifecycleCacheKey: string,
): PublishedChartSnapshot | null {
  if (
    publishedChartCache?.meta.treeId === meta.treeId &&
    publishedChartCache.meta.versionSeq === meta.versionSeq &&
    publishedChartCache.overridesUpdatedAt === overridesUpdatedAt &&
    publishedChartCache.employeeLifecycleCacheKey === employeeLifecycleCacheKey
  ) {
    return publishedChartCache.snapshot;
  }
  return null;
}

export function rememberPublishedChartSnapshot(
  meta: PublishedTreeMeta,
  overridesUpdatedAt: string | null,
  employeeLifecycleCacheKey: string,
  snapshot: PublishedChartSnapshot,
): PublishedChartSnapshot {
  publishedChartCache = {
    meta,
    overridesUpdatedAt,
    employeeLifecycleCacheKey,
    snapshot,
  };
  return snapshot;
}

export async function fetchEmployeeOverridesUpdatedAt(): Promise<string | null> {
  return withDbRetry(async (sql) => fetchEmployeeOverridesUpdatedAtInner(sql), {
    attempts: 3,
    maxDurationMs: 3_000,
  });
}

async function fetchEmployeeOverridesUpdatedAtInner(
  sql: postgres.Sql,
): Promise<string | null> {
  const rows = await sql<{ updated_at: string | null }[]>`
    select max(updated_at)::text as updated_at
    from organelle.employee_overrides o
    join organelle.trees t on t.tree_id = o.tree_id
    where t.kind = 'published'
  `;
  return rows[0]?.updated_at ?? null;
}

export async function fetchPublishedChartSnapshot(): Promise<PublishedChartSnapshot> {
  const [meta, overridesUpdatedAt, employeeLifecycleCacheKey] = await Promise.all([
    fetchPublishedTreeMetadata(),
    fetchEmployeeOverridesUpdatedAt(),
    fetchEmployeeLifecycleCacheKey(),
  ]);
  const cached = getCachedPublishedChartSnapshot(
    meta,
    overridesUpdatedAt,
    employeeLifecycleCacheKey,
  );
  if (cached) return cached;

  const rows = await fetchTreeRows(meta.treeId);
  const snapshot = buildChartSnapshot({ ...meta, rows });
  return rememberPublishedChartSnapshot(
    meta,
    overridesUpdatedAt,
    employeeLifecycleCacheKey,
    snapshot,
  );
}
