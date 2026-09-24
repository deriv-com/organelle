import { describe, expect, it } from "vitest";

import {
  EDGE_MARGIN_PX,
  EDGE_OVERSHOOT_PX,
  edgePanVelocity,
  MAX_PX_PER_MS,
} from "./edge-pan";

const RECT = { left: 0, top: 0, right: 1000, bottom: 600 };

describe("edgePanVelocity", () => {
  it("is zero in the container interior", () => {
    expect(edgePanVelocity(500, 300, RECT)).toEqual({ dx: 0, dy: 0 });
  });

  it("is zero exactly at the margin boundary", () => {
    expect(edgePanVelocity(EDGE_MARGIN_PX, 300, RECT).dx).toBe(0);
    expect(edgePanVelocity(1000 - EDGE_MARGIN_PX, 300, RECT).dx).toBe(0);
    expect(edgePanVelocity(500, EDGE_MARGIN_PX, RECT).dy).toBe(0);
    expect(edgePanVelocity(500, 600 - EDGE_MARGIN_PX, RECT).dy).toBe(0);
  });

  it("slides content right (positive dx) near the left edge, revealing the left side", () => {
    // Halfway into the margin: half speed.
    expect(edgePanVelocity(EDGE_MARGIN_PX / 2, 300, RECT).dx).toBeCloseTo(
      MAX_PX_PER_MS / 2,
    );
    // At the edge: full speed.
    expect(edgePanVelocity(0, 300, RECT).dx).toBeCloseTo(MAX_PX_PER_MS);
  });

  it("slides content left (negative dx) near the right edge, revealing the right side", () => {
    expect(edgePanVelocity(1000 - EDGE_MARGIN_PX / 2, 300, RECT).dx).toBeCloseTo(
      -MAX_PX_PER_MS / 2,
    );
    expect(edgePanVelocity(1000, 300, RECT).dx).toBeCloseTo(-MAX_PX_PER_MS);
  });

  it("slides content down near the top edge and up near the bottom edge", () => {
    expect(edgePanVelocity(500, 0, RECT).dy).toBeCloseTo(MAX_PX_PER_MS);
    expect(edgePanVelocity(500, 600, RECT).dy).toBeCloseTo(-MAX_PX_PER_MS);
  });

  it("pans on both axes in a corner", () => {
    const { dx, dy } = edgePanVelocity(0, 600, RECT);
    expect(dx).toBeCloseTo(MAX_PX_PER_MS);
    expect(dy).toBeCloseTo(-MAX_PX_PER_MS);
  });

  it("holds full speed for a small overshoot past the container edge", () => {
    expect(edgePanVelocity(-EDGE_OVERSHOOT_PX, 300, RECT).dx).toBeCloseTo(
      MAX_PX_PER_MS,
    );
    expect(edgePanVelocity(1000 + EDGE_OVERSHOOT_PX, 300, RECT).dx).toBeCloseTo(
      -MAX_PX_PER_MS,
    );
  });

  it("does nothing far outside the container (e.g. over the topbar)", () => {
    expect(edgePanVelocity(-EDGE_OVERSHOOT_PX - 1, 300, RECT).dx).toBe(0);
    expect(edgePanVelocity(1000 + EDGE_OVERSHOOT_PX + 1, 300, RECT).dx).toBe(0);
    expect(edgePanVelocity(500, -EDGE_OVERSHOOT_PX - 1, RECT).dy).toBe(0);
    expect(edgePanVelocity(500, 600 + EDGE_OVERSHOOT_PX + 1, RECT).dy).toBe(0);
  });
});
