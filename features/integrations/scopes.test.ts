import { describe, expect, it } from "vitest";

import {
  hasAllScopes,
  isKnownScope,
  parseScopes,
  STRUCTURE_HEADERS_READ,
} from "./scopes";

describe("scopes", () => {
  it("recognizes the v1 scope allow-list", () => {
    expect(isKnownScope(STRUCTURE_HEADERS_READ)).toBe(true);
    expect(isKnownScope("structure.seats.read")).toBe(false);
  });

  it("rejects unknown scopes in parseScopes", () => {
    expect(parseScopes([STRUCTURE_HEADERS_READ])).toEqual([STRUCTURE_HEADERS_READ]);
    expect(parseScopes(["nope"])).toBeNull();
    expect(parseScopes([])).toBeNull();
  });

  it("checks required scopes", () => {
    expect(hasAllScopes([STRUCTURE_HEADERS_READ], [STRUCTURE_HEADERS_READ])).toBe(true);
    expect(hasAllScopes([], [STRUCTURE_HEADERS_READ])).toBe(false);
  });
});
