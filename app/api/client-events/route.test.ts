import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth/session", () => ({
  requireActor: vi.fn(),
  jsonNotAllowed: (status: 401 | 403) =>
    Response.json({ error: "Not allowed" }, { status }),
}));

vi.mock("@/lib/app-logging", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/app-logging")>("@/lib/app-logging");
  return {
    ...actual,
    logEvent: vi.fn(),
  };
});

import { requireActor } from "@/features/auth/session";
import { logEvent } from "@/lib/app-logging";
import { clearRateLimitBuckets } from "@/lib/rate-limit";

import { POST } from "@/app/api/client-events/route";

const actor = {
  ok: true as const,
  actor: {
    authId: "emp-1",
    email: "ada@example.com",
    name: "Ada",
    role: "viewer" as const,
  },
};

function request(body: unknown, bytes?: string) {
  return new Request("http://organelle.local/api/client-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: bytes ?? JSON.stringify(body),
  });
}

describe("POST /api/client-events", () => {
  beforeEach(() => {
    clearRateLimitBuckets();
    vi.mocked(requireActor).mockResolvedValue(actor);
    vi.mocked(logEvent).mockClear();
  });

  afterEach(() => {
    clearRateLimitBuckets();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireActor).mockResolvedValue({ ok: false, status: 401 });
    const response = await POST(request({ type: "window_error" }));
    expect(response.status).toBe(401);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("returns 204 and logs a sanitized event", async () => {
    const response = await POST(
      request({
        type: "window_error",
        message: "boom",
        pathname: "/chart?q=1",
      }),
    );
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        logger: "client.events",
        fields: expect.objectContaining({
          event_type: "window_error",
          pathname: "/chart",
          actor_auth_id: "emp-1",
        }),
      }),
    );
  });

  it("returns 400 for forbidden keys and 413 for oversized bodies", async () => {
    const forbidden = await POST(request({ type: "window_error", rows: [] }));
    expect(forbidden.status).toBe(400);
    const oversized = await POST(request({}, "x".repeat(8 * 1024 + 1)));
    expect(oversized.status).toBe(413);
  });

  it("rate-limits to 20 reports per actor per minute", async () => {
    for (let i = 0; i < 20; i++) {
      const response = await POST(request({ type: "chart_limit", pathname: "/chart" }));
      expect(response.status).toBe(204);
    }
    const limited = await POST(request({ type: "chart_limit", pathname: "/chart" }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });
});
