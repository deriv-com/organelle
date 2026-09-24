import { describe, expect, it } from "vitest";

import { classifyZone } from "./zone";

describe("classifyZone", () => {
  it("rejects empty canvas", () => {
    expect(classifyZone(null, { insideCard: false, relY: 0.5, side: null })).toEqual({
      zone: "reject",
      reason: "Drop on a card",
    });
  });

  it("treats anywhere on a header card as child", () => {
    for (const relY of [0.1, 0.5, 0.9]) {
      expect(
        classifyZone({ kind: "header" }, { insideCard: true, relY, side: null }),
      ).toEqual({
        zone: "child",
      });
    }
  });

  it("splits a seat card into peer (top quarter) and child (the rest)", () => {
    expect(
      classifyZone({ kind: "seat" }, { insideCard: true, relY: 0.1, side: null }),
    ).toEqual({
      zone: "peer",
    });
    expect(
      classifyZone({ kind: "seat" }, { insideCard: true, relY: 0.25, side: null }),
    ).toEqual({
      zone: "peer",
    });
    expect(
      classifyZone({ kind: "seat" }, { insideCard: true, relY: 0.26, side: null }),
    ).toEqual({
      zone: "child",
    });
    expect(
      classifyZone({ kind: "seat" }, { insideCard: true, relY: 0.9, side: null }),
    ).toEqual({
      zone: "child",
    });
  });

  it("maps left/right gap strips to sibling insert", () => {
    for (const kind of ["seat", "header"] as const) {
      expect(
        classifyZone({ kind }, { insideCard: false, relY: 0.5, side: "left" }),
      ).toEqual({ zone: "sibling-before" });
      expect(
        classifyZone({ kind }, { insideCard: false, relY: 0.5, side: "right" }),
      ).toEqual({ zone: "sibling-after" });
    }
  });

  it("rejects a miss with no side even when a target is known", () => {
    expect(
      classifyZone({ kind: "seat" }, { insideCard: false, relY: 0.5, side: null }),
    ).toEqual({
      zone: "reject",
      reason: "Drop on a card",
    });
  });
});
