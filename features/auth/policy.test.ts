import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  APP_ROLES,
  canChangeAdminRole,
  DIRECTORY_STATUS_ROLES,
  emailDomainOk,
  hasAllowedRole,
  resolveActorFromEmail,
} from "./policy";

describe("APP_ROLES", () => {
  it("contains every role exactly once", () => {
    expect(APP_ROLES).toEqual(["viewer", "developer", "editor", "publisher", "admin"]);
    expect(new Set(APP_ROLES).size).toBe(APP_ROLES.length);
  });
});

describe("emailDomainOk", () => {
  const originalDomains = process.env.ALLOWED_EMAIL_DOMAINS;

  beforeEach(() => {
    process.env.ALLOWED_EMAIL_DOMAINS = "example.com,community.org";
  });

  afterEach(() => {
    if (originalDomains === undefined) delete process.env.ALLOWED_EMAIL_DOMAINS;
    else process.env.ALLOWED_EMAIL_DOMAINS = originalDomains;
  });

  it("accepts configured domains case-insensitively", () => {
    expect(emailDomainOk("jy@example.com")).toBe(true);
    expect(emailDomainOk("JY@COMMUNITY.ORG")).toBe(true);
  });

  it("rejects other domains", () => {
    expect(emailDomainOk("a@gmail.com")).toBe(false);
    expect(emailDomainOk("a@another-example.net")).toBe(false);
  });
});

describe("resolveActorFromEmail", () => {
  const originalDomains = process.env.ALLOWED_EMAIL_DOMAINS;

  beforeEach(() => {
    process.env.ALLOWED_EMAIL_DOMAINS = "example.com";
  });

  afterEach(() => {
    if (originalDomains === undefined) delete process.env.ALLOWED_EMAIL_DOMAINS;
    else process.env.ALLOWED_EMAIL_DOMAINS = originalDomains;
  });

  it("rejects a missing session", () => {
    const result = resolveActorFromEmail(null, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unauthenticated");
  });

  it("rejects the wrong domain", () => {
    const result = resolveActorFromEmail("ada@gmail.com", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("wrong_domain");
  });

  it("rejects a session with no employees row", () => {
    const result = resolveActorFromEmail("new@example.com", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_in_directory");
  });

  it("defaults missing app_roles to viewer", () => {
    const result = resolveActorFromEmail("e@example.com", {
      authId: "id-1",
      name: "Ed",
      role: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.actor.role).toBe("viewer");
  });
});

describe("hasAllowedRole", () => {
  it("does not treat publisher as admin", () => {
    expect(hasAllowedRole("publisher", ["admin"])).toBe(false);
    expect(hasAllowedRole("admin", ["admin"])).toBe(true);
  });

  it("lets publisher merge but not a viewer or editor", () => {
    const merge = ["publisher", "admin"] as const;
    expect(hasAllowedRole("viewer", merge)).toBe(false);
    expect(hasAllowedRole("editor", merge)).toBe(false);
    expect(hasAllowedRole("publisher", merge)).toBe(true);
  });

  it("limits directory status changes to publishers and admins", () => {
    expect(hasAllowedRole("viewer", DIRECTORY_STATUS_ROLES)).toBe(false);
    expect(hasAllowedRole("editor", DIRECTORY_STATUS_ROLES)).toBe(false);
    expect(hasAllowedRole("publisher", DIRECTORY_STATUS_ROLES)).toBe(true);
  });
});

describe("canChangeAdminRole", () => {
  it("blocks stripping the last admin", () => {
    expect(canChangeAdminRole(1, true, "viewer")).toBe(false);
    expect(canChangeAdminRole(1, true, "editor")).toBe(false);
  });

  it("allows demoting an admin when another remains", () => {
    expect(canChangeAdminRole(2, true, "editor")).toBe(true);
  });
});
