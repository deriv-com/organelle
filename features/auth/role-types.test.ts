import { describe, expect, it } from "vitest";

import { toRoleRow } from "./role-types";

describe("toRoleRow", () => {
  it("maps missing app_roles rows to viewer", () => {
    expect(
      toRoleRow({
        auth_id: "auth-1",
        full_name: "Ada Lovelace",
        email: "ada@example.com",
        role: null,
      }),
    ).toEqual({
      authId: "auth-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      role: "viewer",
    });
  });

  it("keeps explicit app roles", () => {
    expect(
      toRoleRow({
        auth_id: "auth-2",
        full_name: "Grace Hopper",
        email: "grace@example.com",
        role: "admin",
      }).role,
    ).toBe("admin");
  });

  it("keeps employees with missing names searchable by email", () => {
    expect(
      toRoleRow({
        auth_id: "auth-3",
        full_name: null,
        email: "missing-name@example.com",
        role: null,
      }),
    ).toEqual({
      authId: "auth-3",
      name: "",
      email: "missing-name@example.com",
      role: "viewer",
    });
  });
});
