import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getToken } = vi.hoisted(() => ({ getToken: vi.fn() }));
vi.mock("next-auth/jwt", () => ({ getToken }));

import { middleware } from "./middleware";

function makeRequest(pathname: string, authorization?: string): NextRequest {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  return new NextRequest(new URL(`http://localhost${pathname}`), { headers });
}

describe("middleware", () => {
  afterEach(() => {
    getToken.mockReset();
    vi.unstubAllEnvs();
  });

  it("passes machine routes with an API-key bearer", async () => {
    const response = await middleware(
      makeRequest("/api/integrations/v1/structure/headers", "Bearer org_testsecret"),
    );
    expect(response.status).toBe(200);
  });

  it("redirects protected routes without an OIDC session", async () => {
    getToken.mockResolvedValue(null);
    const response = await middleware(makeRequest("/api/chart/published"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("allows health and authentication routes", async () => {
    expect((await middleware(makeRequest("/api/health"))).status).toBe(200);
    expect((await middleware(makeRequest("/api/auth/signin"))).status).toBe(200);
  });

  it("allows protected routes with a verified session token", async () => {
    getToken.mockResolvedValue({ email: "admin@example.com" });
    expect((await middleware(makeRequest("/chart"))).status).toBe(200);
  });

  it("allows the development identity only in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_DEV_EMAIL", "admin@example.com");
    expect((await middleware(makeRequest("/chart"))).status).toBe(200);
  });

  it("rejects the development identity in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_DEV_EMAIL", "admin@example.com");
    getToken.mockResolvedValue(null);
    const response = await middleware(makeRequest("/chart"));
    expect(response.status).toBe(307);
  });
});
