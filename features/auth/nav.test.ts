import { describe, expect, it } from "vitest";

import { canAccessPath, isNavActive, navItemsForRole } from "./nav";
import type { AppRole } from "./policy";

const hrefs = (role: AppRole, shared = false) =>
  navItemsForRole(role, shared).map((item) => item.href);

describe("navigation policy", () => {
  it("shows the expected role-specific navigation", () => {
    expect(hrefs("viewer")).toEqual(["/chart", "/directory"]);
    expect(hrefs("developer")).toEqual(["/chart", "/directory"]);
    expect(hrefs("editor")).toEqual(["/chart", "/directory", "/sandboxes"]);
    expect(hrefs("publisher")).toEqual([
      "/chart",
      "/directory",
      "/sandboxes",
      "/versions",
    ]);
    expect(hrefs("admin")).toEqual([
      "/chart",
      "/directory",
      "/sandboxes",
      "/sandbox-access",
      "/versions",
      "/audit",
      "/integrations",
      "/admin/roles",
    ]);
  });

  it("enforces privileged routes", () => {
    expect(canAccessPath("viewer", "/versions", false)).toBe(false);
    expect(canAccessPath("publisher", "/versions", false)).toBe(true);
    expect(canAccessPath("publisher", "/changes", false)).toBe(true);
    expect(canAccessPath("publisher", "/audit", false)).toBe(false);
    expect(canAccessPath("admin", "/audit", false)).toBe(true);
    expect(canAccessPath("developer", "/integrations", false)).toBe(false);
    expect(canAccessPath("admin", "/integrations", false)).toBe(true);
  });

  it("permits explicitly shared sandbox routes", () => {
    expect(canAccessPath("viewer", "/sandboxes", true)).toBe(true);
    expect(canAccessPath("viewer", "/sandbox/abc", true)).toBe(true);
    expect(canAccessPath("viewer", "/sandbox/abc/sync", true)).toBe(false);
  });

  it("marks nested navigation routes active", () => {
    expect(isNavActive("/versions/x", "/versions")).toBe(true);
    expect(isNavActive("/chart", "/chart")).toBe(true);
  });
});
