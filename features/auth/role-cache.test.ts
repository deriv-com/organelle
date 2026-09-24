import { describe, expect, it } from "vitest";

import {
  ROLE_DIRECTORY_CACHE_TTL_MS,
  clearRoleDirectoryCache,
  getCachedRoleDirectoryRows,
  rememberRoleDirectoryRows,
} from "./role-cache";
import type { RoleRow } from "./role-types";

const rows: RoleRow[] = [
  {
    authId: "auth-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    role: "admin",
  },
];

describe("role directory cache", () => {
  it("returns remembered rows until the cache expires", () => {
    clearRoleDirectoryCache();
    rememberRoleDirectoryRows(rows, 1_000);

    expect(getCachedRoleDirectoryRows(1_000 + ROLE_DIRECTORY_CACHE_TTL_MS - 1)).toBe(
      rows,
    );
    expect(getCachedRoleDirectoryRows(1_000 + ROLE_DIRECTORY_CACHE_TTL_MS)).toBeNull();
  });

  it("can be cleared after role mutations", () => {
    clearRoleDirectoryCache();
    rememberRoleDirectoryRows(rows, 1_000);
    clearRoleDirectoryCache();

    expect(getCachedRoleDirectoryRows(1_001)).toBeNull();
  });
});
