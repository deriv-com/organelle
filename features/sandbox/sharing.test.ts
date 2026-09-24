import { beforeEach, describe, expect, it, vi } from "vitest";

const requireActor = vi.fn();
const requireRole = vi.fn();
const withDbRetry = vi.fn();
const sandboxAccessWithSql = vi.fn();

vi.mock("@/features/auth/session", () => ({
  EDITOR_ROLES: ["editor", "publisher", "admin"],
  SANDBOX_SHARING_ROLES: ["admin", "publisher"],
  hasAllowedRole: (role: string, allowed: readonly string[]) => allowed.includes(role),
  requireActor: (...args: unknown[]) => requireActor(...args),
  requireRole: (...args: unknown[]) => requireRole(...args),
}));

vi.mock("@/lib/db", () => ({
  withDbRetry: (...args: unknown[]) => withDbRetry(...args),
}));

vi.mock("./access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./access")>()),
  sandboxAccessWithSql: (...args: unknown[]) => sandboxAccessWithSql(...args),
}));

import { grantSandboxAccess, listSandboxAccessOverview } from "./sharing";

const TREE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const RECIPIENT_ID = "33333333-3333-4333-8333-333333333333";

describe("sandbox sharing persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists the assigned Viewer grant when the recipient currently has an elevated role", async () => {
    requireActor.mockResolvedValue({
      ok: true,
      actor: {
        authId: OWNER_ID,
        email: "owner@example.com",
        name: "Owner",
        role: "editor",
      },
    });
    sandboxAccessWithSql.mockResolvedValue({
      ownerAuthId: OWNER_ID,
      archived: false,
      canManageSharing: true,
    });

    let insertedAccessLevel: unknown;
    let auditedAccessLevel: unknown;
    const tx = Object.assign(
      vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        if (query.includes("select e.auth_id")) {
          return [{ auth_id: RECIPIENT_ID, role: "admin" }];
        }
        if (query.includes("select share_id")) return [];
        if (query.includes("insert into organelle.sandbox_shares")) {
          insertedAccessLevel = values[2];
        }
        if (query.includes("insert into organelle.change_log")) {
          auditedAccessLevel = values.at(-1);
        }
        return [];
      }),
      { json: vi.fn((value: unknown) => value) },
    );
    const sql = {
      begin: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    withDbRetry.mockImplementation(async (operation) => operation(sql));

    await expect(grantSandboxAccess(TREE_ID, RECIPIENT_ID, "viewer")).resolves.toEqual({
      ok: true,
    });
    expect(insertedAccessLevel).toBe("viewer");
    expect(auditedAccessLevel).toEqual({ access_level: "viewer" });
  });

  it("rejects an Editor grant for a global Viewer before writing", async () => {
    requireActor.mockResolvedValue({
      ok: true,
      actor: {
        authId: OWNER_ID,
        email: "owner@example.com",
        name: "Owner",
        role: "editor",
      },
    });
    sandboxAccessWithSql.mockResolvedValue({
      ownerAuthId: OWNER_ID,
      archived: false,
      canManageSharing: true,
    });

    let wroteShare = false;
    const tx = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("select e.auth_id")) {
        return [{ auth_id: RECIPIENT_ID, role: "viewer" }];
      }
      if (query.includes("insert into organelle.sandbox_shares")) wroteShare = true;
      return [];
    });
    const sql = {
      begin: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    withDbRetry.mockImplementation(async (operation) => operation(sql));

    await expect(grantSandboxAccess(TREE_ID, RECIPIENT_ID, "editor")).resolves.toEqual({
      ok: false,
      reason: "Editor access requires an Editor, Publisher, or Admin role",
    });
    expect(wroteShare).toBe(false);
  });

  it("normalizes a missing owner name in the access overview", async () => {
    requireRole.mockResolvedValue({
      ok: true,
      actor: {
        authId: OWNER_ID,
        email: "admin@example.com",
        name: "Admin",
        role: "admin",
      },
    });
    const sql = vi.fn().mockResolvedValue([
      {
        tree_id: TREE_ID,
        name: "Unnamed owner sandbox",
        owner_auth_id: OWNER_ID,
        owner_name: null,
        owner_email: null,
        archived_at: null,
        viewer_count: 0,
        editor_count: 0,
        updated_at: "2026-09-23T00:00:00.000Z",
      },
    ]);
    withDbRetry.mockImplementation(async (operation) => operation(sql));

    await expect(listSandboxAccessOverview()).resolves.toEqual([
      expect.objectContaining({ ownerName: "Unknown owner" }),
    ]);
  });
});
