import { describe, expect, it } from "vitest";

import { GAP_STRIP_PX, hitTest, type CardRect } from "./hit-test";

function rect(
  id: string,
  left: number,
  top: number,
  width = 220,
  height = 80,
): CardRect {
  return { id, left, top, width, height };
}

describe("hitTest", () => {
  it("hits the card interior over a neighbouring gap", () => {
    const a = rect("a", 0, 0);
    const b = rect("b", 250, 0);
    expect(hitTest(100, 40, [a, b], "src")).toEqual({
      targetId: "a",
      insideCard: true,
      relY: 0.5,
      side: null,
    });
  });

  it("classifies a left strip as sibling-before", () => {
    const a = rect("a", 100, 0);
    expect(hitTest(100 - GAP_STRIP_PX / 2, 40, [a], "src")).toEqual({
      targetId: "a",
      insideCard: false,
      relY: 0.5,
      side: "left",
    });
  });

  it("classifies a right strip as sibling-after", () => {
    const a = rect("a", 100, 0);
    expect(hitTest(100 + 220 + GAP_STRIP_PX / 2, 40, [a], "src")).toEqual({
      targetId: "a",
      insideCard: false,
      relY: 0.5,
      side: "right",
    });
  });

  it("picks the closer card edge when two strips overlap in the gutter", () => {
    const a = rect("a", 0, 0);
    const b = rect("b", 250, 0);
    // Gutter 220–250. Midpoint 235. Just left of mid → a-right; just right → b-left.
    expect(hitTest(230, 40, [a, b], "src")).toMatchObject({
      targetId: "a",
      insideCard: false,
      side: "right",
    });
    expect(hitTest(240, 40, [a, b], "src")).toMatchObject({
      targetId: "b",
      insideCard: false,
      side: "left",
    });
  });

  it("skips the dragged node's rect", () => {
    const src = rect("src", 0, 0);
    const a = rect("a", 250, 0);
    expect(hitTest(100, 40, [src, a], "src")).toEqual({
      targetId: null,
      insideCard: false,
      relY: 0.5,
      side: null,
    });
  });

  it("misses empty space and vertical gutters below a card", () => {
    const a = rect("a", 0, 0);
    expect(hitTest(110, 200, [a], "src")).toEqual({
      targetId: null,
      insideCard: false,
      relY: 0.5,
      side: null,
    });
    expect(hitTest(400, 40, [a], "src")).toEqual({
      targetId: null,
      insideCard: false,
      relY: 0.5,
      side: null,
    });
  });
});
