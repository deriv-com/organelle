import { beforeEach, describe, expect, it, vi } from "vitest";

const requireActor = vi.fn();
const listSandboxesForActor = vi.fn();
const listSharedSandboxesForActor = vi.fn();

vi.mock("@/features/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/auth/session")>();
  return {
    ...actual,
    requireActor: (...args: unknown[]) => requireActor(...args),
  };
});
vi.mock("@/features/sandbox/queries", () => ({
  listSandboxesForActor: (...args: unknown[]) => listSandboxesForActor(...args),
  listSharedSandboxesForActor: (...args: unknown[]) =>
    listSharedSandboxesForActor(...args),
}));

import { GET } from "./route";

const actor = {
  authId: "owner-1",
  email: "owner@example.com",
  name: "Owner",
  role: "editor" as const,
};

describe("GET /api/sandboxes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSandboxesForActor.mockResolvedValue([{ treeId: "owned-1" }]);
    listSharedSandboxesForActor.mockResolvedValue([{ treeId: "shared-1" }]);
  });

  it.each(["viewer", "developer"] as const)(
    "does not list owned sandboxes after demotion to %s",
    async (role) => {
      requireActor.mockResolvedValue({ ok: true, actor: { ...actor, role } });

      const response = await GET();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        owned: [],
        shared: [{ treeId: "shared-1" }],
      });
      expect(listSandboxesForActor).not.toHaveBeenCalled();
      expect(listSharedSandboxesForActor).toHaveBeenCalledWith(actor.authId);
    },
  );

  it("lists owned and shared sandboxes for an Editor", async () => {
    requireActor.mockResolvedValue({ ok: true, actor });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      owned: [{ treeId: "owned-1" }],
      shared: [{ treeId: "shared-1" }],
    });
    expect(listSandboxesForActor).toHaveBeenCalledWith(actor.authId);
    expect(listSharedSandboxesForActor).toHaveBeenCalledWith(actor.authId);
  });
});
