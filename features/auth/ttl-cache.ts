export const ROLE_CACHE_TTL_MS = 30_000;

type CacheEntry<T> = {
  value: T;
  cachedAt: number;
};

export function createTtlCache<T>() {
  let entry: CacheEntry<T> | null = null;

  return {
    get(now = Date.now(), ttlMs = ROLE_CACHE_TTL_MS): T | null {
      if (!entry || now - entry.cachedAt >= ttlMs) return null;
      return entry.value;
    },
    getWithFresh(
      now = Date.now(),
      ttlMs = ROLE_CACHE_TTL_MS,
    ): { value: T; fresh: boolean } | null {
      if (!entry) return null;
      return { value: entry.value, fresh: now - entry.cachedAt < ttlMs };
    },
    set(value: T, now = Date.now()): T {
      entry = { value, cachedAt: now };
      return value;
    },
    clear() {
      entry = null;
    },
    update(updater: (value: T) => T) {
      if (!entry) return;
      entry = { ...entry, value: updater(entry.value) };
    },
  };
}
