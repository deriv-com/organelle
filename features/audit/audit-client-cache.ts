import type { AuditFilters } from "./filters";
import type { AuditActorOption, AuditOpOption, AuditPageData } from "./types";

export const AUDIT_CLIENT_CACHE_TTL_MS = 30_000;

export type AuditPayload = {
  filters: AuditFilters;
  data: AuditPageData;
  actors: AuditActorOption[];
  ops: AuditOpOption[];
};

type AuditCacheEntry = {
  payload: AuditPayload;
  cachedAt: number;
};

const cache = new Map<string, AuditCacheEntry>();

export function auditCacheKey(filters: AuditFilters): string {
  return JSON.stringify({
    scope: filters.scope,
    query: filters.query,
    actor: filters.actor,
    op: filters.op,
    page: filters.page,
  });
}

export function getCachedAuditPayload(
  filters: AuditFilters,
  now = Date.now(),
): { payload: AuditPayload; fresh: boolean } | null {
  const cached = cache.get(auditCacheKey(filters));
  if (!cached) return null;
  return {
    payload: cached.payload,
    fresh: now - cached.cachedAt < AUDIT_CLIENT_CACHE_TTL_MS,
  };
}

export function rememberAuditPayload(
  payload: AuditPayload,
  now = Date.now(),
): AuditPayload {
  cache.set(auditCacheKey(payload.filters), { payload, cachedAt: now });
  return payload;
}

export function clearAuditClientCache() {
  cache.clear();
}
