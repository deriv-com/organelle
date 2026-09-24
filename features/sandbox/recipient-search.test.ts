import { describe, expect, it } from "vitest";

import {
  parseRecipientSearch,
  SANDBOX_RECIPIENT_RESULT_LIMIT,
  searchRecipientCandidates,
} from "./recipient-search";

describe("sandbox recipient search", () => {
  it("normalizes a name into independent search tokens", () => {
    expect(parseRecipientSearch("  Sat   Gaw  ")).toEqual({
      normalized: "sat gaw",
      tokens: ["sat", "gaw"],
    });
  });

  it("keeps email punctuation literal and removes duplicate tokens", () => {
    expect(parseRecipientSearch("Amy amy@example.com amy")).toEqual({
      normalized: "amy amy@example.com amy",
      tokens: ["amy", "amy@example.com"],
    });
  });

  it("searches from the first character and rejects only an empty query", () => {
    expect(parseRecipientSearch(" a ")).toEqual({ normalized: "a", tokens: ["a"] });
    expect(parseRecipientSearch("   ")).toBeNull();
  });

  it("allows more than the old eight-result ceiling", () => {
    expect(SANDBOX_RECIPIENT_RESULT_LIMIT).toBe(20);
  });

  it("filters and ranks an already-loaded recipient catalog immediately", () => {
    const people = [
      { name: "Amy Zed", email: "zed@example.com" },
      { name: "Amy Exact", email: "amy@example.com" },
      { name: "Zed Amy", email: "other@example.com" },
    ];

    expect(searchRecipientCandidates(people, "amy")).toEqual([
      people[1],
      people[0],
      people[2],
    ]);
    expect(searchRecipientCandidates(people, "amy ex")).toEqual([people[1]]);
  });

  it("does not match everyone through the shared email domain", () => {
    const people = [
      { name: "Cameron Fixture", email: "cameron.fixture@example.com" },
      { name: "Avery Fixture", email: "avery.fixture@example.com" },
    ];

    expect(searchRecipientCandidates(people, "cameron")).toEqual([people[0]]);
    expect(searchRecipientCandidates(people, "avery.fixture@example.com")).toEqual([
      people[1],
    ]);
  });
});
