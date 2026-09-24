import { describe, expect, it } from "vitest";

import {
  ROLE_CLIENT_CACHE_TTL_MS,
  clearRoleClientCache,
  getCachedRoleRows,
  rememberRoleRows,
  updateCachedRoleRow,
} from "./role-client-cache";
import type { RoleRow } from "./role-types";

const rows: RoleRow[] = [
  {
    authId: "auth-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    role: "viewer",
  },
];

describe("role client cache", () => {
  it("marks remembered rows fresh until the TTL expires", () => {
    clearRoleClientCache();
    rememberRoleRows(rows, 1_000);

    expect(getCachedRoleRows(1_000 + ROLE_CLIENT_CACHE_TTL_MS - 1)).toEqual({
      rows,
      fresh: true,
    });
    expect(getCachedRoleRows(1_000 + ROLE_CLIENT_CACHE_TTL_MS)).toEqual({
      rows,
      fresh: false,
    });
  });

  it("updates cached role rows after a successful mutation", () => {
    clearRoleClientCache();
    rememberRoleRows(rows, 1_000);
    updateCachedRoleRow("auth-1", "admin");

    expect(getCachedRoleRows(1_001)?.rows[0]?.role).toBe("admin");
  });
});
