import { describe, expect, it } from "vitest";

import { generateApiKey } from "./api-key-crypto";
import { requireApiKey } from "./api-key-auth";
import { STRUCTURE_HEADERS_READ } from "./scopes";
import type { ApiKeyAuthRecord } from "./api-keys-store";

function requestWithBearer(secret: string | null): Request {
  const headers = new Headers();
  if (secret) headers.set("authorization", `Bearer ${secret}`);
  return new Request("http://localhost/api/integrations/v1/structure/headers", {
    headers,
  });
}

describe("requireApiKey", () => {
  it("accepts a valid key with the required scope", async () => {
    const generated = generateApiKey();
    const record: ApiKeyAuthRecord = {
      id: "11111111-1111-1111-1111-111111111111",
      label: "payroll",
      keyHash: generated.keyHash,
      scopes: [STRUCTURE_HEADERS_READ],
      expiresAt: "2099-01-01T00:00:00.000Z",
      revokedAt: null,
    };
    const result = await requireApiKey(
      [STRUCTURE_HEADERS_READ],
      requestWithBearer(generated.secret),
      async () => record,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actor.keyId).toBe(record.id);
      expect(result.actor.label).toBe("payroll");
    }
  });

  it("rejects missing Authorization", async () => {
    const result = await requireApiKey(
      [STRUCTURE_HEADERS_READ],
      requestWithBearer(null),
      async () => null,
    );
    expect(result).toEqual({
      ok: false,
      status: 401,
      reason: "Missing or invalid API key",
    });
  });

  it("rejects wrong hash", async () => {
    const generated = generateApiKey();
    const other = generateApiKey();
    const result = await requireApiKey(
      [STRUCTURE_HEADERS_READ],
      requestWithBearer(generated.secret),
      async () => ({
        id: "11111111-1111-1111-1111-111111111111",
        label: "x",
        keyHash: other.keyHash,
        scopes: [STRUCTURE_HEADERS_READ],
        expiresAt: "2099-01-01T00:00:00.000Z",
        revokedAt: null,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("rejects revoked keys", async () => {
    const generated = generateApiKey();
    const result = await requireApiKey(
      [STRUCTURE_HEADERS_READ],
      requestWithBearer(generated.secret),
      async () => ({
        id: "11111111-1111-1111-1111-111111111111",
        label: "x",
        keyHash: generated.keyHash,
        scopes: [STRUCTURE_HEADERS_READ],
        expiresAt: "2099-01-01T00:00:00.000Z",
        revokedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("rejects expired keys", async () => {
    const generated = generateApiKey();
    const result = await requireApiKey(
      [STRUCTURE_HEADERS_READ],
      requestWithBearer(generated.secret),
      async () => ({
        id: "11111111-1111-1111-1111-111111111111",
        label: "x",
        keyHash: generated.keyHash,
        scopes: [STRUCTURE_HEADERS_READ],
        expiresAt: "2000-01-01T00:00:00.000Z",
        revokedAt: null,
      }),
    );
    expect(result).toEqual({
      ok: false,
      status: 401,
      reason: "Missing or invalid API key",
    });
  });

  it("rejects missing scope with 403", async () => {
    const generated = generateApiKey();
    const result = await requireApiKey(
      [STRUCTURE_HEADERS_READ],
      requestWithBearer(generated.secret),
      async () => ({
        id: "11111111-1111-1111-1111-111111111111",
        label: "x",
        keyHash: generated.keyHash,
        scopes: [],
        expiresAt: "2099-01-01T00:00:00.000Z",
        revokedAt: null,
      }),
    );
    expect(result).toEqual({
      ok: false,
      status: 403,
      reason: "Insufficient scope",
    });
  });
});
