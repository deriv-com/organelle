import type { RoleRow } from "./role-types";
import { ROLE_CACHE_TTL_MS, createTtlCache } from "./ttl-cache";

/** Per-replica; clearRoleDirectoryCache() only clears the current process. */
const cache = createTtlCache<RoleRow[]>();

export const ROLE_DIRECTORY_CACHE_TTL_MS = ROLE_CACHE_TTL_MS;

export function getCachedRoleDirectoryRows(now = Date.now()): RoleRow[] | null {
  return cache.get(now, ROLE_CACHE_TTL_MS);
}

export function rememberRoleDirectoryRows(
  rows: RoleRow[],
  now = Date.now(),
): RoleRow[] {
  return cache.set(rows, now);
}

export function clearRoleDirectoryCache() {
  cache.clear();
}
