import { describe, expect, it } from "vitest";

import { auditOffset, auditSearchTokens, parseAuditFilters } from "./filters";

describe("parseAuditFilters", () => {
  it("defaults invalid params to the all-context audit page", () => {
    expect(
      parseAuditFilters({
        scope: "everything",
        page: "-4",
        actor: "not-a-uuid",
        op: "drop table",
        q: "  hello    audit  ",
      }),
    ).toEqual({
      scope: "all",
      page: 1,
      actor: null,
      op: null,
      query: "hello audit",
    });
  });

  it("accepts supported filters", () => {
    expect(
      parseAuditFilters({
        scope: "sandbox",
        page: "3",
        actor: "550e8400-e29b-41d4-a716-446655440000",
        op: "move_node",
        q: "Moved employee",
      }),
    ).toEqual({
      scope: "sandbox",
      page: 3,
      actor: "550e8400-e29b-41d4-a716-446655440000",
      op: "move_node",
      query: "Moved employee",
    });
  });

  it("normalises search into SQL-friendly tokens", () => {
    expect(auditSearchTokens("  Moved employee: Amy@example.com  ")).toEqual([
      "moved",
      "employee",
      "amy@example.com",
    ]);
  });

  it("calculates the server-side page offset", () => {
    expect(auditOffset(1)).toBe(0);
    expect(auditOffset(3)).toBe(100);
  });
});
