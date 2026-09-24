import { beforeEach, describe, expect, it, vi } from "vitest";

const withDbRetry = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  withDbRetry: (...args: unknown[]) => withDbRetry(...args),
}));

import { mapSandboxSummary } from "./query-map";
import { listSharedSandboxesForActor } from "./queries";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mapSandboxSummary", () => {
  it("maps database rows to sandbox summaries", () => {
    expect(
      mapSandboxSummary({
        tree_id: "sandbox-tree",
        name: "Q4 reorg",
        created_at: "2026-08-20T00:00:00.000Z",
        forked_from_seq: 12,
        change_count: 3,
        owner_auth_id: "owner-auth-id",
        live_seq: 14,
        archived_at: null,
      }),
    ).toEqual({
      treeId: "sandbox-tree",
      name: "Q4 reorg",
      createdAt: "2026-08-20T00:00:00.000Z",
      forkedFromSeq: 12,
      changeCount: 3,
      ownerAuthId: "owner-auth-id",
      liveSeq: 14,
      isStale: true,
      archived: false,
    });
  });

  it("marks archived when archived_at is set", () => {
    expect(
      mapSandboxSummary({
        tree_id: "sandbox-tree",
        name: "Old",
        created_at: "2026-08-20T00:00:00.000Z",
        forked_from_seq: 12,
        change_count: 0,
        owner_auth_id: "owner-auth-id",
        live_seq: 12,
        archived_at: "2026-08-28T00:00:00.000Z",
      }).archived,
    ).toBe(true);
  });
});

describe("listSharedSandboxesForActor", () => {
  it("falls back from a missing owner name to email and then Unknown owner", async () => {
    const sql = vi.fn().mockResolvedValue([
      {
        tree_id: "shared-with-email",
        name: "Shared with email",
        created_at: "2026-09-23T00:00:00.000Z",
        forked_from_seq: 12,
        change_count: 0,
        owner_auth_id: "owner-with-email",
        live_seq: 12,
        archived_at: null,
        access_level: "viewer",
        owner_name: null,
        owner_email: "owner@example.com",
      },
      {
        tree_id: "shared-without-identity",
        name: "Shared without identity",
        created_at: "2026-09-22T00:00:00.000Z",
        forked_from_seq: 12,
        change_count: 0,
        owner_auth_id: "owner-without-identity",
        live_seq: 12,
        archived_at: null,
        access_level: "editor",
        owner_name: "   ",
        owner_email: "   ",
      },
    ]);
    withDbRetry.mockImplementation(async (operation) => operation(sql));

    await expect(listSharedSandboxesForActor("recipient-id")).resolves.toEqual([
      expect.objectContaining({ ownerName: "owner@example.com" }),
      expect.objectContaining({ ownerName: "Unknown owner" }),
    ]);
  });
});
