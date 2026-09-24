import { fetchEmployeeOverridesUpdatedAt } from "@/features/chart/chart-data";
import {
  buildChart,
  toPublicChartRows,
  type PublicChartRow,
} from "@/features/chart/chart-row";
import { fetchTree, type SandboxPayload } from "@/features/chart/tree-query";
import { fetchEmployeeLifecycleCacheKey } from "@/features/employees/status-lifecycle.server";

export const VERSION_CHART_CACHE_LIMIT = 10;

export interface VersionChartSnapshot {
  treeId: string;
  treeKind: "published" | "historical";
  versionSeq: number | null;
  rows: PublicChartRow[];
}

interface CachedVersionChartSnapshot {
  overridesUpdatedAt: string | null;
  employeeLifecycleCacheKey: string;
  snapshot: VersionChartSnapshot;
}

const versionChartCache = new Map<string, CachedVersionChartSnapshot>();

export function buildVersionChartSnapshot(
  payload: SandboxPayload,
): VersionChartSnapshot | null {
  if (payload.kind !== "published" && payload.kind !== "historical") return null;
  return {
    treeId: payload.treeId,
    treeKind: payload.kind,
    versionSeq: payload.versionSeq,
    rows: toPublicChartRows(buildChart(payload.rows).rows),
  };
}

export function clearVersionChartSnapshotCache() {
  versionChartCache.clear();
}

export function getVersionChartSnapshotCacheSize(): number {
  return versionChartCache.size;
}

export function getCachedVersionChartSnapshot(
  treeId: string,
  overridesUpdatedAt: string | null,
  employeeLifecycleCacheKey: string,
): VersionChartSnapshot | null {
  const cached = versionChartCache.get(treeId);
  if (
    !cached ||
    cached.overridesUpdatedAt !== overridesUpdatedAt ||
    cached.employeeLifecycleCacheKey !== employeeLifecycleCacheKey
  ) {
    return null;
  }

  // Refresh recency for the bounded cache.
  versionChartCache.delete(treeId);
  versionChartCache.set(treeId, cached);
  return cached.snapshot;
}

export function rememberVersionChartSnapshot(
  treeId: string,
  overridesUpdatedAt: string | null,
  employeeLifecycleCacheKey: string,
  snapshot: VersionChartSnapshot,
  limit = VERSION_CHART_CACHE_LIMIT,
): VersionChartSnapshot {
  if (versionChartCache.has(treeId)) versionChartCache.delete(treeId);
  versionChartCache.set(treeId, {
    overridesUpdatedAt,
    employeeLifecycleCacheKey,
    snapshot,
  });

  while (versionChartCache.size > limit) {
    const oldest = versionChartCache.keys().next().value;
    if (!oldest) break;
    versionChartCache.delete(oldest);
  }

  return snapshot;
}

export async function fetchVersionChartSnapshot(
  treeId: string,
): Promise<VersionChartSnapshot | null> {
  const [overridesUpdatedAt, employeeLifecycleCacheKey] = await Promise.all([
    fetchEmployeeOverridesUpdatedAt(),
    fetchEmployeeLifecycleCacheKey(),
  ]);
  const cached = getCachedVersionChartSnapshot(
    treeId,
    overridesUpdatedAt,
    employeeLifecycleCacheKey,
  );
  if (cached) return cached;

  const payload = await fetchTree(treeId);
  if (!payload) return null;

  const snapshot = buildVersionChartSnapshot(payload);
  if (!snapshot) return null;

  return rememberVersionChartSnapshot(
    treeId,
    overridesUpdatedAt,
    employeeLifecycleCacheKey,
    snapshot,
  );
}
