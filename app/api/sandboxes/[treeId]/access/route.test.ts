import { beforeEach, describe, expect, it, vi } from "vitest";

const requireActor = vi.fn();
const getSandboxAccess = vi.fn();

vi.mock("@/features/auth/session", () => ({
  requireActor: (...args: unknown[]) => requireActor(...args),
}));
vi.mock("@/features/sandbox/access", () => ({
  getSandboxAccess: (...args: unknown[]) => getSandboxAccess(...args),
}));

import { GET } from "./route";

const actor = {
  authId: "viewer-1",
  email: "viewer@example.com",
  name: "Viewer",
  role: "viewer",
};

describe("GET /api/sandboxes/:treeId/access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a recipient after their access ends", async () => {
    requireActor.mockResolvedValue({ ok: true, actor });
    getSandboxAccess.mockResolvedValue({ canView: false });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ treeId: "sandbox-1" }),
    });

    expect(response.status).toBe(403);
    expect(getSandboxAccess).toHaveBeenCalledWith("sandbox-1", actor);
  });

  it("returns a non-cacheable success while access remains active", async () => {
    requireActor.mockResolvedValue({ ok: true, actor });
    getSandboxAccess.mockResolvedValue({ canView: true });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ treeId: "sandbox-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ canView: true });
  });
});
