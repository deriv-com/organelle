import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppRole } from "@/features/auth/policy";

const harness = vi.hoisted(() => {
  const requireRole = vi.fn();
  const queries: string[] = [];
  const state: {
    trees: Array<{
      kind: string;
      owner_auth_id: string | null;
      archived_at?: string | null;
    }>;
    history: Array<Record<string, unknown>>;
  } = { trees: [], history: [] };
  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push(query);
    if (query.includes("from organelle.trees")) return state.trees;
    if (query.includes("from organelle.change_log")) return state.history;
    return [];
  });
  return { queries, requireRole, sql, state };
});

vi.mock("@/features/auth/session", () => ({
  EDITOR_ROLES: ["editor", "publisher", "admin", "publisher"],
  requireRole: (...args: unknown[]) => harness.requireRole(...args),
}));

vi.mock("@/lib/db", () => ({
  withDbRetry: (fn: (sql: typeof harness.sql) => unknown) => fn(harness.sql),
}));

import { getSandboxHistory } from "./actions/undo";

const TREE_ID = "11111111-1111-4111-8111-111111111111";
const ROLES: AppRole[] = ["editor", "publisher", "admin", "publisher"];

function allow(actorId: string, role: AppRole) {
  harness.requireRole.mockResolvedValue({
    ok: true,
    actor: { authId: actorId, role, email: `${actorId}@example.com`, name: actorId },
  });
}

describe("getSandboxHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.queries.length = 0;
    harness.state.trees = [];
    harness.state.history = [];
  });

  it.each(ROLES)("returns history to the owner with the %s role", async (role) => {
    allow("owner", role);
    harness.state.trees = [{ kind: "sandbox", owner_auth_id: "owner" }];
    harness.state.history = [
      { id: "2", op: "move_node" },
      { id: "1", op: "create_seat" },
    ];

    await expect(getSandboxHistory(TREE_ID)).resolves.toEqual(harness.state.history);
    expect(harness.queries).toHaveLength(2);
    expect(harness.queries[1]).toContain("order by cl.id desc");
    expect(harness.queries[1]).not.toMatch(/\blimit\s+500\b/i);
  });

  it.each(ROLES)(
    "denies a non-owner with the %s role before loading history",
    async (role) => {
      allow("other", role);
      harness.state.trees = [{ kind: "sandbox", owner_auth_id: "owner" }];

      await expect(getSandboxHistory(TREE_ID)).resolves.toEqual([]);
      expect(harness.queries).toHaveLength(1);
      expect(harness.queries[0]).toContain("owner_auth_id");
    },
  );

  it.each([
    ["missing owner", { kind: "sandbox", owner_auth_id: null }],
    ["published tree", { kind: "published", owner_auth_id: "owner" }],
    ["historical tree", { kind: "historical", owner_auth_id: "owner" }],
  ] as const)("denies a %s before loading history", async (_label, tree) => {
    allow("owner", "editor");
    harness.state.trees = [tree];

    await expect(getSandboxHistory(TREE_ID)).resolves.toEqual([]);
    expect(harness.queries).toHaveLength(1);
  });

  it("denies a missing tree before loading history", async () => {
    allow("owner", "editor");

    await expect(getSandboxHistory(TREE_ID)).resolves.toEqual([]);
    expect(harness.queries).toHaveLength(1);
  });

  it.each(["unauthenticated", "viewer", "developer"])(
    "denies %s access without querying the database",
    async () => {
      harness.requireRole.mockResolvedValue({ ok: false, reason: "Forbidden" });

      await expect(getSandboxHistory(TREE_ID)).resolves.toEqual([]);
      expect(harness.queries).toHaveLength(0);
    },
  );

  it("rejects a malformed id before checking the session or database", async () => {
    await expect(getSandboxHistory("not-a-uuid")).resolves.toEqual([]);
    expect(harness.requireRole).not.toHaveBeenCalled();
    expect(harness.queries).toHaveLength(0);
  });

  it("allows an owner to read archived sandbox history", async () => {
    allow("owner", "editor");
    harness.state.trees = [
      { kind: "sandbox", owner_auth_id: "owner", archived_at: "2026-09-16" },
    ];
    harness.state.history = [{ id: "1", op: "archive_sandbox" }];

    await expect(getSandboxHistory(TREE_ID)).resolves.toEqual(harness.state.history);
    expect(harness.queries).toHaveLength(2);
  });
});
