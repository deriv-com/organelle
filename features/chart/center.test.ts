import { describe, expect, it } from "vitest";
import { zoomIdentity } from "d3";

import { cardCenterTransform, nodeInViewport } from "./center";

describe("cardCenterTransform", () => {
  it("maps the card centre to the viewport centre at the given scale", () => {
    const t = cardCenterTransform({
      nodeX: 400,
      nodeY: 100,
      nodeHeight: 96,
      svgWidth: 1000,
      svgHeight: 800,
      scale: 0.5,
    });
    expect(t.apply([400, 100 + 96 / 2])).toEqual([500, 400]);
    expect(t.k).toBe(0.5);
  });

  it("keeps a 1x zoom readable (does not fit the whole tree)", () => {
    const t = cardCenterTransform({
      nodeX: 0,
      nodeY: 0,
      nodeHeight: 96,
      svgWidth: 800,
      svgHeight: 600,
      scale: 1,
    });
    expect(t.k).toBe(1);
    expect(t.apply([0, 48])).toEqual([400, 300]);
  });
});

describe("nodeInViewport", () => {
  const box = {
    nodeWidth: 220,
    nodeHeight: 72,
    svgWidth: 1000,
    svgHeight: 800,
  };

  it("returns true when the card sits inside the inset viewport", () => {
    expect(
      nodeInViewport({
        ...box,
        nodeX: 400,
        nodeY: 200,
        transform: zoomIdentity,
      }),
    ).toBe(true);
  });

  it("returns true when the card overlaps the inset edge", () => {
    expect(
      nodeInViewport({
        ...box,
        nodeX: 20,
        nodeY: 0,
        transform: zoomIdentity,
      }),
    ).toBe(true);
  });

  it("returns false when the card is fully off-screen", () => {
    expect(
      nodeInViewport({
        ...box,
        nodeX: 2000,
        nodeY: 200,
        transform: zoomIdentity,
      }),
    ).toBe(false);
  });

  it("returns false when the card only occupies the inset margin", () => {
    expect(
      nodeInViewport({
        ...box,
        nodeX: -105,
        nodeY: 200,
        transform: zoomIdentity,
      }),
    ).toBe(false);
  });

  it("applies the current zoom transform", () => {
    const transform = zoomIdentity.translate(0, 0).scale(0.5);
    expect(
      nodeInViewport({
        ...box,
        nodeX: 400,
        nodeY: 200,
        transform,
      }),
    ).toBe(true);
    expect(
      nodeInViewport({
        ...box,
        nodeX: 4000,
        nodeY: 200,
        transform,
      }),
    ).toBe(false);
  });
});
