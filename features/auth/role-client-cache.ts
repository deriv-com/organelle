import type { RoleRow } from "./role-types";
import { ROLE_CACHE_TTL_MS, createTtlCache } from "./ttl-cache";

/** Per-replica client-side role list cache. */
const cache = createTtlCache<RoleRow[]>();

export const ROLE_CLIENT_CACHE_TTL_MS = ROLE_CACHE_TTL_MS;

export function getCachedRoleRows(
  now = Date.now(),
): { rows: RoleRow[]; fresh: boolean } | null {
  const cached = cache.getWithFresh(now, ROLE_CACHE_TTL_MS);
  if (!cached) return null;
  return { rows: cached.value, fresh: cached.fresh };
}

export function rememberRoleRows(rows: RoleRow[], now = Date.now()): RoleRow[] {
  return cache.set(rows, now);
}

export function updateCachedRoleRow(authId: string, role: RoleRow["role"]) {
  cache.update((rows) =>
    rows.map((row) => (row.authId === authId ? { ...row, role } : row)),
  );
}

export function clearRoleClientCache() {
  cache.clear();
}
