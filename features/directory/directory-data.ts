import { buildChart, type SeatMember } from "@/features/chart/chart-row";
import {
  fetchPublishedTreeMetadata,
  fetchTreeRows,
  type PublishedTreeMeta,
  type TreePayload,
} from "@/features/chart/tree-query";
import { fetchEmployeeLifecycleCacheKey } from "@/features/employees/status-lifecycle.server";
import { withDbRetry } from "@/lib/db";
import {
  buildDirectoryRows,
  resignedDirectoryRow,
  toPublicDirectoryRows,
  type DirectoryRow,
  type PublicDirectoryRow,
} from "./directory-row";
import { mergeResignedRows } from "./directory-visibility";
import type { HeaderOption } from "./filter-bar";
import { buildHeaderOptions } from "./header-options";

export interface PublishedDirectorySnapshot {
  treeId: string;
  versionSeq: number;
  publishedAt: string | null;
  rows: PublicDirectoryRow[];
  headers: HeaderOption[];
}

interface CachedPublishedDirectorySnapshot {
  meta: PublishedTreeMeta;
  overridesUpdatedAt: string | null;
  employeeLifecycleCacheKey: string;
  snapshot: PublishedDirectorySnapshot;
}

let publishedDirectoryCache: CachedPublishedDirectorySnapshot | null = null;
// Per-replica module cache; invalidates on version_seq / override / lifecycle key change (Q11).

export function buildDirectorySnapshot(
  payload: TreePayload,
): PublishedDirectorySnapshot {
  const { rows: chartRows } = buildChart(payload.rows);
  return {
    treeId: payload.treeId,
    versionSeq: payload.versionSeq,
    publishedAt: payload.publishedAt,
    rows: toPublicDirectoryRows(buildDirectoryRows(chartRows)),
    headers: buildHeaderOptions(chartRows),
  };
}

export function clearPublishedDirectorySnapshotCache() {
  publishedDirectoryCache = null;
}

export function getCachedPublishedDirectorySnapshot(
  meta: PublishedTreeMeta,
  overridesUpdatedAt: string | null,
  employeeLifecycleCacheKey: string,
): PublishedDirectorySnapshot | null {
  if (
    publishedDirectoryCache?.meta.treeId === meta.treeId &&
    publishedDirectoryCache.meta.versionSeq === meta.versionSeq &&
    publishedDirectoryCache.overridesUpdatedAt === overridesUpdatedAt &&
    publishedDirectoryCache.employeeLifecycleCacheKey === employeeLifecycleCacheKey
  ) {
    return publishedDirectoryCache.snapshot;
  }
  return null;
}

export function rememberPublishedDirectorySnapshot(
  meta: PublishedTreeMeta,
  overridesUpdatedAt: string | null,
  employeeLifecycleCacheKey: string,
  snapshot: PublishedDirectorySnapshot,
): PublishedDirectorySnapshot {
  publishedDirectoryCache = {
    meta,
    overridesUpdatedAt,
    employeeLifecycleCacheKey,
    snapshot,
  };
  return snapshot;
}

export async function fetchEmployeeOverridesUpdatedAt(): Promise<string | null> {
  return withDbRetry(async (sql) => {
    const rows = await sql<{ updated_at: string | null }[]>`
      select max(updated_at)::text as updated_at
      from organelle.employee_overrides o
      join organelle.trees t on t.tree_id = o.tree_id
      where t.kind = 'published'
    `;
    return rows[0]?.updated_at ?? null;
  });
}

function resignedMember(row: {
  auth_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  office_location: string | null;
  job_title: string | null;
  joining_date: string | null;
  primary_team_path: string | null;
}): SeatMember {
  const name = row.full_name ?? "Unknown";
  return {
    authId: row.auth_id,
    displayName: name,
    displayTitle: row.job_title ?? "",
    email: row.email ?? "",
    avatarUrl: row.avatar_url,
    officeLocation: row.office_location ?? "",
    status: "resigned",
    joiningDate: row.joining_date,
    isHost: true,
    sourceName: name,
    sourceTitle: row.job_title ?? "",
    sourceAvatarUrl: row.avatar_url,
    overrideName: null,
    overrideTitle: null,
    overrideAvatarUrl: null,
    primaryTeamPath: row.primary_team_path,
  };
}

export async function fetchResignedDirectoryRows(): Promise<DirectoryRow[]> {
  return withDbRetry(async (sql) => {
    const rows = await sql<
      {
        auth_id: string;
        full_name: string | null;
        email: string | null;
        avatar_url: string | null;
        office_location: string | null;
        job_title: string | null;
        joining_date: string | null;
        primary_team_path: string | null;
      }[]
    >`
      select auth_id, full_name, email, avatar_url, office_location, job_title,
             joining_date::text as joining_date, primary_team_path
        from organelle.employees
       where sandbox_tree_id is null
         and status = 'resigned'::organelle.employee_status
    `;
    return rows.map((row) =>
      resignedDirectoryRow(resignedMember(row), row.primary_team_path ?? ""),
    );
  });
}

export async function fetchPublishedDirectorySnapshot(): Promise<PublishedDirectorySnapshot> {
  const [meta, overridesUpdatedAt, employeeLifecycleCacheKey] = await Promise.all([
    fetchPublishedTreeMetadata(),
    fetchEmployeeOverridesUpdatedAt(),
    fetchEmployeeLifecycleCacheKey(),
  ]);
  const cached = getCachedPublishedDirectorySnapshot(
    meta,
    overridesUpdatedAt,
    employeeLifecycleCacheKey,
  );
  if (cached) return cached;

  const rows = await fetchTreeRows(meta.treeId);
  const snapshot = buildDirectorySnapshot({ ...meta, rows });
  snapshot.rows = mergeResignedRows(
    snapshot.rows,
    toPublicDirectoryRows(await fetchResignedDirectoryRows()),
  );
  return rememberPublishedDirectorySnapshot(
    meta,
    overridesUpdatedAt,
    employeeLifecycleCacheKey,
    snapshot,
  );
}
