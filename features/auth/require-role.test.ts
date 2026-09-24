import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { statusForActorFailure } from "./policy";
import {
  ADMIN_ROLES,
  EDITOR_ROLES,
  INTEGRATIONS_ROLES,
  MERGE_ROLES,
  RESTORE_ROLES,
  hasAllowedRole,
  resolveActorFromEmail,
  type AppRole,
} from "./policy";

describe("http auth status", () => {
  it("maps unauthenticated to 401 and directory/domain failures to 403", () => {
    expect(statusForActorFailure("unauthenticated")).toBe(401);
    expect(statusForActorFailure("wrong_domain")).toBe(403);
    expect(statusForActorFailure("not_in_directory")).toBe(403);
  });
});

const LOOKUP = { authId: "emp-1", name: "Ada", role: null as AppRole | null };

describe("session fixtures", () => {
  const originalDomains = process.env.ALLOWED_EMAIL_DOMAINS;

  beforeEach(() => {
    process.env.ALLOWED_EMAIL_DOMAINS = "example.com";
  });

  afterEach(() => {
    if (originalDomains === undefined) delete process.env.ALLOWED_EMAIL_DOMAINS;
    else process.env.ALLOWED_EMAIL_DOMAINS = originalDomains;
  });

  it("wrong domain never becomes an actor", () => {
    const result = resolveActorFromEmail("ada@gmail.com", LOOKUP);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("wrong_domain");
  });

  it("missing employee is authenticated but blocked", () => {
    const result = resolveActorFromEmail("new@example.com", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_in_directory");
  });
});

describe("mutation allow-lists", () => {
  it("viewer cannot fork or edit a sandbox", () => {
    expect(hasAllowedRole("viewer", EDITOR_ROLES)).toBe(false);
  });

  it("editor can fork but cannot merge or grant roles", () => {
    expect(hasAllowedRole("editor", EDITOR_ROLES)).toBe(true);
    expect(hasAllowedRole("editor", MERGE_ROLES)).toBe(false);
    expect(hasAllowedRole("editor", ADMIN_ROLES)).toBe(false);
  });

  it("publisher can merge and cannot manage roles", () => {
    expect(hasAllowedRole("publisher", MERGE_ROLES)).toBe(true);
    expect(hasAllowedRole("publisher", ADMIN_ROLES)).toBe(false);
  });

  it("admin can grant roles; publisher cannot", () => {
    expect(hasAllowedRole("admin", ADMIN_ROLES)).toBe(true);
    expect(hasAllowedRole("publisher", ADMIN_ROLES)).toBe(false);
    expect(hasAllowedRole("publisher", MERGE_ROLES)).toBe(true);
  });

  it("only admins can open Integrations", () => {
    expect(hasAllowedRole("developer", INTEGRATIONS_ROLES)).toBe(false);
    expect(hasAllowedRole("admin", INTEGRATIONS_ROLES)).toBe(true);
    expect(hasAllowedRole("editor", INTEGRATIONS_ROLES)).toBe(false);
    expect(hasAllowedRole("viewer", INTEGRATIONS_ROLES)).toBe(false);
    expect(hasAllowedRole("developer", EDITOR_ROLES)).toBe(false);
  });

  it("publisher and admin can restore versions", () => {
    expect(hasAllowedRole("publisher", RESTORE_ROLES)).toBe(true);
    expect(hasAllowedRole("editor", RESTORE_ROLES)).toBe(false);
    expect(hasAllowedRole("viewer", RESTORE_ROLES)).toBe(false);
    expect(hasAllowedRole("admin", RESTORE_ROLES)).toBe(true);
  });
});
