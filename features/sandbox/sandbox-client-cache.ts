import type { SandboxListPayload } from "./types";

export const SANDBOX_CLIENT_CACHE_TTL_MS = 30_000;

type SandboxClientCacheEntry = {
  payload: SandboxListPayload;
  cachedAt: number;
};

let sandboxClientCache: SandboxClientCacheEntry | null = null;

export function getCachedSandboxList(
  now = Date.now(),
): (SandboxListPayload & { fresh: boolean }) | null {
  if (!sandboxClientCache) return null;
  return {
    ...sandboxClientCache.payload,
    fresh: now - sandboxClientCache.cachedAt < SANDBOX_CLIENT_CACHE_TTL_MS,
  };
}

export function rememberSandboxList(
  payload: SandboxListPayload,
  now = Date.now(),
): SandboxListPayload {
  sandboxClientCache = { payload, cachedAt: now };
  return payload;
}

export function removeCachedSandbox(treeId: string) {
  if (!sandboxClientCache) return;
  sandboxClientCache = {
    ...sandboxClientCache,
    payload: {
      owned: sandboxClientCache.payload.owned.filter((row) => row.treeId !== treeId),
      shared: sandboxClientCache.payload.shared.filter((row) => row.treeId !== treeId),
    },
  };
}

/** Flip `archived` on a cached row (archive / restore / post-merge). */
export function setCachedSandboxArchived(treeId: string, archived: boolean) {
  if (!sandboxClientCache) return;
  sandboxClientCache = {
    ...sandboxClientCache,
    payload: {
      owned: sandboxClientCache.payload.owned.map((row) =>
        row.treeId === treeId ? { ...row, archived } : row,
      ),
      shared: sandboxClientCache.payload.shared.map((row) =>
        row.treeId === treeId ? { ...row, archived } : row,
      ),
    },
  };
}

export function clearSandboxClientCache() {
  sandboxClientCache = null;
}
