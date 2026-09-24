import { describe, expect, it } from "vitest";

import { oidcConfigured, oidcUserFromProfile } from "./options";

describe("OIDC configuration", () => {
  const complete = {
    NODE_ENV: "test",
    OIDC_ISSUER: "https://identity.example.com",
    OIDC_CLIENT_ID: "organelle",
    OIDC_CLIENT_SECRET: "client-secret",
    AUTH_SECRET: "session-secret-with-at-least-32-characters",
  } as NodeJS.ProcessEnv;

  it("accepts a complete generic provider configuration", () => {
    expect(oidcConfigured(complete)).toBe(true);
  });

  it.each(["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "AUTH_SECRET"])(
    "rejects configuration without %s",
    (name) => {
      expect(oidcConfigured({ ...complete, [name]: "" })).toBe(false);
    },
  );
});

describe("OIDC profile validation", () => {
  it("requires a stable subject and explicitly verified email", () => {
    expect(() =>
      oidcUserFromProfile({ sub: "subject-1", email: "ada@example.com" }),
    ).toThrow(/verified email/);
    expect(() =>
      oidcUserFromProfile({ email: "ada@example.com", email_verified: true }),
    ).toThrow(/subject/);
  });

  it("normalizes a verified profile", () => {
    expect(
      oidcUserFromProfile({
        sub: "subject-1",
        email: " ADA@EXAMPLE.COM ",
        email_verified: true,
        name: "Ada",
      }),
    ).toMatchObject({ id: "subject-1", email: "ada@example.com", name: "Ada" });
  });
});
