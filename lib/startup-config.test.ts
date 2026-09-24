import { describe, expect, it } from "vitest";

import { assertSecureProductionConfig } from "./startup-config";

describe("production authentication secret", () => {
  it("rejects missing, short, and known placeholder values", () => {
    for (const secret of [
      undefined,
      "short",
      "change-this-before-production",
      "replace-with-at-least-32-random-bytes",
    ]) {
      expect(() =>
        assertSecureProductionConfig({ NODE_ENV: "production", AUTH_SECRET: secret }),
      ).toThrow(/AUTH_SECRET/);
    }
  });

  it("accepts a long production secret and ignores development", () => {
    expect(() =>
      assertSecureProductionConfig({
        NODE_ENV: "production",
        AUTH_SECRET: "a-secure-random-value-with-more-than-32-characters",
      }),
    ).not.toThrow();
    expect(() =>
      assertSecureProductionConfig({ NODE_ENV: "development" }),
    ).not.toThrow();
  });
});
