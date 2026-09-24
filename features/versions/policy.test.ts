import { describe, expect, it } from "vitest";

import { formatMergeCounts, restoreSourceAllowed } from "./policy";

describe("restoreSourceAllowed", () => {
  it("rejects the current published tree", () => {
    const result = restoreSourceAllowed("published");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("Already live");
  });

  it("rejects sandboxes", () => {
    const result = restoreSourceAllowed("sandbox");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("Not a published version");
  });

  it("allows a historical tree", () => {
    expect(restoreSourceAllowed("historical").ok).toBe(true);
  });
});

describe("formatMergeCounts", () => {
  it("skips zeros and empty maps", () => {
    expect(formatMergeCounts(null)).toBeNull();
    expect(formatMergeCounts({ moves: 0, edits: 0 })).toBeNull();
    expect(formatMergeCounts({ moves: 3, creates: 1 })).toBe("3 moves · 1 creates");
  });
});
