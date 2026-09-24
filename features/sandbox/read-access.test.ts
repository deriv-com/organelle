import { describe, expect, it } from "vitest";

import { canReadSandboxHistory } from "./read-access";

describe("canReadSandboxHistory", () => {
  it.each(["editor", "publisher", "admin", "publisher"] as const)(
    "allows a sandbox owner with the %s role",
    (role) => {
      expect(
        canReadSandboxHistory({
          kind: "sandbox",
          ownerAuthId: "owner",
          actorId: "owner",
          role,
        }),
      ).toBe(true);
    },
  );

  it.each(["editor", "publisher", "admin", "publisher"] as const)(
    "rejects a non-owner with the %s role",
    (role) => {
      expect(
        canReadSandboxHistory({
          kind: "sandbox",
          ownerAuthId: "owner",
          actorId: "other",
          role,
        }),
      ).toBe(false);
    },
  );

  it("rejects a missing owner, disallowed roles, and non-sandbox trees", () => {
    const base = { kind: "sandbox", ownerAuthId: "owner", actorId: "owner" };
    expect(canReadSandboxHistory({ ...base, ownerAuthId: null, role: "editor" })).toBe(
      false,
    );
    expect(canReadSandboxHistory({ ...base, role: "viewer" })).toBe(false);
    expect(canReadSandboxHistory({ ...base, role: "developer" })).toBe(false);
    expect(canReadSandboxHistory({ ...base, kind: "published", role: "editor" })).toBe(
      false,
    );
    expect(canReadSandboxHistory({ ...base, kind: "historical", role: "admin" })).toBe(
      false,
    );
  });
});
