import { describe, expect, it } from "vitest";

import {
  generateApiKey,
  hashApiKeySecret,
  keyPrefixFromSecret,
  parseBearerToken,
  secretsMatch,
} from "./api-key-crypto";

describe("api-key-crypto", () => {
  it("generates org_ secrets with matching prefix and hash", () => {
    const key = generateApiKey();
    expect(key.secret.startsWith("org_")).toBe(true);
    expect(key.keyPrefix).toBe(keyPrefixFromSecret(key.secret));
    expect(key.keyPrefix.length).toBe(12);
    expect(key.keyHash).toBe(hashApiKeySecret(key.secret));
    expect(secretsMatch(key.secret, key.keyHash)).toBe(true);
  });

  it("hashes stably and rejects mismatches", () => {
    const a = hashApiKeySecret("org_abc");
    const b = hashApiKeySecret("org_abc");
    expect(a).toBe(b);
    expect(secretsMatch("org_abc", a)).toBe(true);
    expect(secretsMatch("org_abd", a)).toBe(false);
  });

  it("parses Bearer tokens and rejects malformed headers", () => {
    expect(parseBearerToken("Bearer org_deadbeef")).toBe("org_deadbeef");
    expect(parseBearerToken("bearer org_deadbeef")).toBe("org_deadbeef");
    expect(parseBearerToken("Bearer not-an-org-key")).toBeNull();
    expect(parseBearerToken("Basic org_x")).toBeNull();
    expect(parseBearerToken(null)).toBeNull();
  });
});
