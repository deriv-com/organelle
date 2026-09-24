import { describe, expect, it } from "vitest";

import {
  SANDBOX_CLIENT_CACHE_TTL_MS,
  clearSandboxClientCache,
  getCachedSandboxList,
  rememberSandboxList,
  removeCachedSandbox,
  setCachedSandboxArchived,
} from "./sandbox-client-cache";
import type { SandboxListPayload, SandboxSummary } from "./types";

const rows: SandboxSummary[] = [
  {
    treeId: "sandbox-1",
    name: "Q4 reorg",
    createdAt: "2026-08-20T00:00:00.000Z",
    forkedFromSeq: 12,
    changeCount: 3,
    ownerAuthId: "owner-1",
    archived: false,
  },
];

const payload: SandboxListPayload = {
  owned: rows,
  shared: [
    {
      ...rows[0]!,
      treeId: "shared-1",
      ownerAuthId: "owner-2",
      ownerName: "Shared Owner",
      accessLevel: "viewer",
    },
  ],
};

describe("sandbox client cache", () => {
  it("marks remembered rows fresh until the TTL expires", () => {
    clearSandboxClientCache();
    rememberSandboxList(payload, 1_000);

    expect(getCachedSandboxList(1_000 + SANDBOX_CLIENT_CACHE_TTL_MS - 1)).toEqual({
      ...payload,
      fresh: true,
    });
    expect(getCachedSandboxList(1_000 + SANDBOX_CLIENT_CACHE_TTL_MS)).toEqual({
      ...payload,
      fresh: false,
    });
  });

  it("removes deleted sandboxes from cache", () => {
    clearSandboxClientCache();
    rememberSandboxList(payload, 1_000);
    removeCachedSandbox("sandbox-1");

    expect(getCachedSandboxList(1_001)?.owned).toEqual([]);
    expect(getCachedSandboxList(1_001)?.shared).toEqual(payload.shared);
  });

  it("flips archived on a cached row", () => {
    clearSandboxClientCache();
    rememberSandboxList(payload, 1_000);
    setCachedSandboxArchived("shared-1", true);

    expect(getCachedSandboxList(1_001)?.shared[0]?.archived).toBe(true);
  });
});
