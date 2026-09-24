import { describe, expect, it } from "vitest";

import type { ChartIndex, ChartRow } from "./chart-row";
import { indexFromRows } from "./chart-row";
import {
  ancestorPath,
  applyExpandChip,
  applyExpandChipMirror,
  applyInitialCollapse,
  collapseAllDescendants,
  collapseNextLevel,
  countExpanded,
  expandAllDescendants,
  expandNextLevel,
  hasVisibleChildren,
  MAX_EXPANDED_NODES,
  PAGE_SIZE,
  remainingCapacity,
  subtreeFullyExpanded,
} from "./collapse";

function rowAt(id: string, parentId = "", sortOrder = 0): ChartRow {
  return { id, parentId, kind: "seat", sortOrder, rowVersion: 1, members: [] };
}

function indexWithDepths(depths: Record<string, number>): ChartIndex {
  return {
    rootId: "root",
    childrenById: new Map(),
    depthById: new Map(Object.entries(depths)),
    deptById: new Map(),
    deptColorById: new Map(),
  };
}

/** root → a, b ; a → a1, a2 ; a1 → leaf */
function sampleTree(): { rows: ChartRow[]; index: ChartIndex } {
  const rows = [
    rowAt("root"),
    rowAt("a", "root", 0),
    rowAt("b", "root", 1),
    rowAt("a1", "a", 0),
    rowAt("a2", "a", 1),
    rowAt("leaf", "a1", 0),
  ];
  return { rows, index: indexFromRows(rows) };
}

describe("applyInitialCollapse", () => {
  it("flags depths 1-2 expanded, collapses depth 3+", () => {
    // Library semantics: `_expanded` on N means N itself is visible (ancestors
    // auto-expand), so depths 1-2 must be flagged to render two levels (Publisher +
    // department headers).
    const rows = [rowAt("root"), rowAt("child"), rowAt("grand"), rowAt("great")];
    applyInitialCollapse(
      rows,
      indexWithDepths({ root: 1, child: 2, grand: 3, great: 4 }),
    );
    expect(rows.map((r) => r._expanded)).toEqual([true, true, false, false]);
  });
});

describe("ancestorPath", () => {
  it("walks parent-by-parent up to the root", () => {
    const parentOf = (id: string) =>
      ({ seat: "team", team: "eng", eng: "root", root: "" })[id] ?? "";
    expect(ancestorPath("seat", parentOf)).toEqual(["team", "eng", "root"]);
    expect(ancestorPath("root", parentOf)).toEqual([]);
  });
});

describe("paging", () => {
  it("pages at 30 children per parent", () => {
    expect(PAGE_SIZE).toBe(30);
  });
});

describe("expand / collapse next vs all", () => {
  it("expandNextLevel flags only direct children", () => {
    const { rows, index } = sampleTree();
    rows.find((r) => r.id === "root")!._expanded = true;
    expandNextLevel(rows, index, "root");
    const flags = Object.fromEntries(rows.map((r) => [r.id, r._expanded === true]));
    expect(flags).toEqual({
      root: true,
      a: true,
      b: true,
      a1: false,
      a2: false,
      leaf: false,
    });
  });

  it("expandAllDescendants flags the whole subtree and bumps paging", () => {
    const { rows, index } = sampleTree();
    rows.find((r) => r.id === "root")!._expanded = true;
    expandAllDescendants(rows, index, "root");
    expect(rows.every((r) => r._expanded)).toBe(true);
    expect(rows.find((r) => r.id === "root")!._pagingStep).toBeGreaterThanOrEqual(1);
    expect(rows.find((r) => r.id === "a")!._pagingStep).toBeGreaterThanOrEqual(1);
  });

  it("expandAllDescendants stays within the global visible budget", () => {
    const root = rowAt("root");
    const kids = Array.from({ length: MAX_EXPANDED_NODES + 50 }, (_, i) =>
      rowAt(`c${i}`, "root", i),
    );
    const rows = [root, ...kids];
    root._expanded = true;
    const index = indexFromRows(rows);
    const outcome = expandAllDescendants(rows, index, "root");
    expect(countExpanded(rows)).toBe(MAX_EXPANDED_NODES);
    expect(outcome).toMatchObject({
      added: MAX_EXPANDED_NODES - 1,
      visible: MAX_EXPANDED_NODES,
      limited: true,
    });
    expect(subtreeFullyExpanded(rows, index, "root")).toBe(false);
    expect(root._pagingStep).toBe(MAX_EXPANDED_NODES - 2);
  });

  it("collapseNextLevel then expandNextLevel opens only direct children", () => {
    const { rows, index } = sampleTree();
    for (const row of rows) row._expanded = true;
    collapseNextLevel(rows, index, "a");
    expect(rows.find((r) => r.id === "a")!._expanded).toBe(true);
    expect(rows.find((r) => r.id === "a1")!._expanded).toBe(false);
    expect(rows.find((r) => r.id === "leaf")!._expanded).toBe(false);
    expect(hasVisibleChildren(rows, index, "a")).toBe(false);

    expandNextLevel(rows, index, "a");
    expect(rows.find((r) => r.id === "a1")!._expanded).toBe(true);
    expect(rows.find((r) => r.id === "a2")!._expanded).toBe(true);
    expect(rows.find((r) => r.id === "leaf")!._expanded).toBe(false);
  });

  it("collapseAllDescendants then expandNextLevel opens only direct children", () => {
    const { rows, index } = sampleTree();
    for (const row of rows) row._expanded = true;
    collapseAllDescendants(rows, index, "a");
    expandNextLevel(rows, index, "a");
    expect(rows.find((r) => r.id === "a1")!._expanded).toBe(true);
    expect(rows.find((r) => r.id === "leaf")!._expanded).toBe(false);
    expect(subtreeFullyExpanded(rows, index, "a")).toBe(false);
  });

  it("keeps the assistant expanded when the parent is collapsed", () => {
    const rows = [
      rowAt("root"),
      { ...rowAt("boss", "root", 0), kind: "seat" as const },
      { ...rowAt("asst", "boss", 0), isAssistant: true },
      rowAt("kid", "boss", 1),
    ];
    const index = indexFromRows(rows);
    for (const row of rows) row._expanded = true;
    collapseAllDescendants(rows, index, "boss");
    expect(rows.find((r) => r.id === "boss")!._expanded).toBe(true);
    expect(rows.find((r) => r.id === "asst")!._expanded).toBe(true);
    expect(rows.find((r) => r.id === "kid")!._expanded).toBe(false);
    expect(hasVisibleChildren(rows, index, "boss")).toBe(false);
  });
});

describe("applyExpandChip", () => {
  it("matches expandNextLevel for level mode", () => {
    const { rows, index } = sampleTree();
    rows.find((r) => r.id === "root")!._expanded = true;
    const direct = structuredClone(rows);
    const viaChip = structuredClone(rows);
    expandNextLevel(direct, index, "root");
    applyExpandChip(viaChip, index, "root", "level");
    expect(viaChip.map((r) => [r.id, r._expanded === true])).toEqual(
      direct.map((r) => [r.id, r._expanded === true]),
    );
  });

  it("matches expandAllDescendants for all mode when closed", () => {
    const { rows, index } = sampleTree();
    rows.find((r) => r.id === "root")!._expanded = true;
    const direct = structuredClone(rows);
    const viaChip = structuredClone(rows);
    expandAllDescendants(direct, index, "root");
    applyExpandChip(viaChip, index, "root", "all");
    expect(viaChip.every((r) => r._expanded)).toBe(direct.every((r) => r._expanded));
  });
});

describe("applyExpandChipMirror", () => {
  it("opens next level on peer when source expanded even if peer started open", () => {
    const { rows, index } = sampleTree();
    rows.find((r) => r.id === "root")!._expanded = true;
    rows.find((r) => r.id === "a")!._expanded = true;
    const peer = structuredClone(rows);
    peer.find((r) => r.id === "a")!._expanded = false;
    applyExpandChipMirror(peer, index, "root", "level", {
      levelOpen: true,
      fullyExpanded: false,
    });
    expect(hasVisibleChildren(peer, index, "root")).toBe(true);
  });

  it("closes next level on peer when source collapsed even if peer started closed", () => {
    const { rows, index } = sampleTree();
    rows.find((r) => r.id === "root")!._expanded = true;
    rows.find((r) => r.id === "a")!._expanded = true;
    const peer = structuredClone(rows);
    applyExpandChipMirror(peer, index, "root", "level", {
      levelOpen: false,
      fullyExpanded: false,
    });
    expect(hasVisibleChildren(peer, index, "root")).toBe(false);
  });
});

function wideTree(branchSize: number): { rows: ChartRow[]; index: ChartIndex } {
  const rows = [rowAt("root"), rowAt("deptA", "root", 0), rowAt("deptB", "root", 1)];
  for (const dept of ["deptA", "deptB"] as const) {
    for (let i = 0; i < branchSize; i++) {
      rows.push(rowAt(`${dept}-${i}`, dept, i));
    }
  }
  const index = indexFromRows(rows);
  rows.find((r) => r.id === "root")!._expanded = true;
  rows.find((r) => r.id === "deptA")!._expanded = true;
  rows.find((r) => r.id === "deptB")!._expanded = true;
  return { rows, index };
}

describe("global visible budget", () => {
  it("counts every expanded row, including headers", () => {
    const rows = [rowAt("root"), rowAt("a", "root")];
    rows[0]!._expanded = true;
    rows[1]!._expanded = true;
    expect(countExpanded(rows)).toBe(2);
    expect(remainingCapacity(rows)).toBe(MAX_EXPANDED_NODES - 2);
  });

  it("repeated expand-all across branches never exceeds 400 visible nodes", () => {
    const { rows, index } = wideTree(250);
    const first = expandAllDescendants(rows, index, "deptA");
    expect(first.limited).toBe(false);
    const second = expandAllDescendants(rows, index, "deptB");
    expect(second.limited).toBe(true);
    expect(countExpanded(rows)).toBe(MAX_EXPANDED_NODES);
    expect(countExpanded(rows)).toBeLessThanOrEqual(MAX_EXPANDED_NODES);
  });

  it("expand-all uses only remaining capacity", () => {
    const { rows, index } = wideTree(50);
    const already = rows.filter((r) => r.id.startsWith("deptA-")).slice(0, 10);
    for (const row of already) row._expanded = true;
    expect(remainingCapacity(rows)).toBe(MAX_EXPANDED_NODES - countExpanded(rows));
    const outcome = expandAllDescendants(rows, index, "deptB");
    expect(outcome.limited).toBe(false);
    expect(countExpanded(rows)).toBeLessThanOrEqual(MAX_EXPANDED_NODES);
  });

  it("collapse frees capacity for another branch", () => {
    const { rows, index } = wideTree(250);
    expandAllDescendants(rows, index, "deptA");
    expandAllDescendants(rows, index, "deptB");
    expect(countExpanded(rows)).toBe(MAX_EXPANDED_NODES);
    collapseAllDescendants(rows, index, "deptA");
    const after = expandAllDescendants(rows, index, "deptB");
    expect(after.limited).toBe(false);
    expect(countExpanded(rows)).toBeLessThanOrEqual(MAX_EXPANDED_NODES);
    expect(rows.filter((r) => r.id.startsWith("deptB-") && r._expanded).length).toBe(
      250,
    );
  });

  it("expandNextLevel respects remaining capacity", () => {
    const root = rowAt("root");
    const kids = Array.from({ length: 20 }, (_, i) => rowAt(`c${i}`, "root", i));
    const rows = [root, ...kids];
    root._expanded = true;
    const already = MAX_EXPANDED_NODES - 5;
    for (let i = 0; i < already - 1; i++) {
      rows.push(rowAt(`filler${i}`, "root", 20 + i));
      rows[rows.length - 1]!._expanded = true;
    }
    const index = indexFromRows(rows);
    const outcome = expandNextLevel(rows, index, "root");
    expect(outcome.limited).toBe(true);
    expect(countExpanded(rows)).toBe(MAX_EXPANDED_NODES);
  });

  it("mirrored expand-all respects the same budget", () => {
    const { rows, index } = wideTree(250);
    expandAllDescendants(rows, index, "deptA");
    const peer = structuredClone(rows);
    applyExpandChipMirror(peer, index, "deptB", "all", {
      levelOpen: true,
      fullyExpanded: true,
    });
    expect(countExpanded(peer)).toBeLessThanOrEqual(MAX_EXPANDED_NODES);
  });

  it("initial collapse of an oversized tree never flags more than 400 nodes", () => {
    const rows = [rowAt("root")];
    for (let i = 0; i < MAX_EXPANDED_NODES + 40; i++) {
      rows.push(rowAt(`d${i}`, "root", i));
    }
    const index = indexFromRows(rows);
    const outcome = applyInitialCollapse(rows, index);
    expect(countExpanded(rows)).toBe(MAX_EXPANDED_NODES);
    expect(outcome.limited).toBe(true);
    expect(rows[0]!._expanded).toBe(true);
  });
});
