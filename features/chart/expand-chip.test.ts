import { describe, expect, it } from "vitest";

import { expandChipHtml } from "./expand-chip";

describe("expandChipHtml", () => {
  it("splits into all-subtree and next-level halves with counts", () => {
    const html = expandChipHtml({
      nextLevelOpen: false,
      fullyExpanded: false,
      total: 218,
      direct: 7,
    });
    expect(html).toContain('data-expand="all"');
    expect(html).toContain('data-expand="level"');
    expect(html).toContain("218");
    expect(html).toContain("7");
    expect(html).toContain("border-radius:3px");
    expect(html).not.toContain("border-radius:999px");
  });

  it("points both chevrons down when collapsed", () => {
    const html = expandChipHtml({
      nextLevelOpen: false,
      fullyExpanded: false,
      total: 10,
      direct: 2,
    });
    expect(html).toContain('data-chevron="down"');
    expect(html).not.toContain('data-chevron="up"');
  });

  it("points mixed chevrons when only the next level is open", () => {
    const html = expandChipHtml({
      nextLevelOpen: true,
      fullyExpanded: false,
      total: 10,
      direct: 2,
    });
    expect(html).toMatch(/data-expand="all"[^>]*data-chevron="down"/);
    expect(html).toMatch(/data-expand="level"[^>]*data-chevron="up"/);
  });

  it("points both chevrons up when the subtree is fully expanded", () => {
    const html = expandChipHtml({
      nextLevelOpen: true,
      fullyExpanded: true,
      total: 219,
      direct: 1,
    });
    expect(html).not.toContain('data-chevron="down"');
    expect(html).toContain('data-chevron="up"');
  });
});
