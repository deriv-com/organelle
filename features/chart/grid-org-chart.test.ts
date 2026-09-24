/**
 * Regression test for the grid base-drift bug: calculateCompactFlexPositions
 * used to read `fch.x` as the column base after the loop's first iteration had
 * already overwritten it (fch IS compactChildren[0]), shifting columns 1+ right
 * by half a column so the last column overflowed the flextree-allocated box and
 * overlapped the next sibling subtree (71 overlapping pairs on the real tree).
 *
 * The layout math is DOM-free; only the OrgChart constructor touches `document`
 * (canvas text measurement), so we stub just enough to instantiate headlessly.
 */

import { stratify } from "d3";
import { flextree } from "d3-flextree";
import type { HierarchyNode } from "d3-hierarchy";
import type { ChartNode } from "d3-org-chart";
import { describe, expect, it } from "vitest";

import {
  ASSISTANT_TRUNK_GUTTER,
  CHILDREN_MARGIN,
  childrenMarginFor,
  GRID_COLUMNS,
  GridOrgChart,
} from "./grid-org-chart";

(globalThis as Record<string, unknown>).document ??= {
  createElement: () => ({ getContext: () => ({ measureText: () => ({ width: 10 }) }) }),
};
(globalThis as Record<string, unknown>).window ??= { navigator: { userAgent: "node" } };

interface TestRow {
  id: string;
  parentId: string | "";
  kind: "header" | "seat";
  isAssistant?: boolean;
  leafGridColumns?: number;
}

// Mirror the library defaults + the app chart config (org-chart.tsx).
const NODE_W = 260;
const NODE_H = 160;
const SIBLINGS_MARGIN = 20;
const NEIGHBOUR_MARGIN = 80;
const COMPACT_MARGIN_PAIR = 100;
const EXTENT = NODE_W * GRID_COLUMNS + COMPACT_MARGIN_PAIR;

type LayoutNode = HierarchyNode<TestRow> & {
  x: number;
  y: number;
  width: number;
  height: number;
  row?: number;
  col?: number;
  firstCompact?: boolean | null;
  compactEven?: boolean | null;
  firstCompactNode?: LayoutNode | null;
  flexCompactDim?: [number, number] | null;
  subtreeExtent?: number | null;
};

function layoutRows(rows: TestRow[]): {
  nodes: LayoutNode[];
  gridBox: [number, number];
  chart: GridOrgChart<TestRow>;
} {
  const chart = new GridOrgChart<TestRow>()
    .nodeWidth(() => NODE_W)
    .nodeHeight(() => NODE_H);
  const root = stratify<TestRow>()
    .id((d) => d.id)
    .parentId((d) => (d.parentId === "" ? null : d.parentId))(rows) as LayoutNode;
  root.each((node) => {
    const n = node as LayoutNode;
    n.width = NODE_W;
    n.height = NODE_H;
  });

  chart.calculateCompactFlexDimensions(root as unknown as ChartNode<TestRow>);

  // Same nodeSize/spacing the library uses for layout "top" (nodeFlexSize).
  const layout = flextree<TestRow>({
    nodeSize: (node) => {
      const n = node as unknown as LayoutNode;
      return (
        n.flexCompactDim ?? [
          NODE_W + SIBLINGS_MARGIN,
          NODE_H + childrenMarginFor(n, NODE_H),
        ]
      );
    },
    spacing: (a, b) => (a.parent === b.parent ? 0 : NEIGHBOUR_MARGIN),
  });
  layout(root);

  // The box flextree allocated to the grid, captured before positions move fch.
  const parent = (root.children ?? [])
    .flatMap((n) => [n as LayoutNode, ...((n.children ?? []) as LayoutNode[])])
    .find((n) => (n.children ?? []).some((c) => (c as LayoutNode).firstCompact));
  const fch = (parent?.children ?? []).find((c) => (c as LayoutNode).firstCompact) as
    LayoutNode | undefined;
  if (!fch) throw new Error("test setup: no compact grid was formed");
  const gridBox: [number, number] = [fch.x - EXTENT / 2, fch.x + EXTENT / 2];

  chart.calculateCompactFlexPositions(root as unknown as ChartNode<TestRow>);
  return { nodes: root.descendants() as LayoutNode[], gridBox, chart };
}

describe("GridOrgChart compact layout", () => {
  // 5 leaf seats grid-wrap (rows of 3 + 2); "mgr" has a child so it stays a
  // normal sibling — the exact mixed-children shape that overlapped in prod.
  const rows: TestRow[] = [
    { id: "root", parentId: "", kind: "seat" },
    { id: "parent", parentId: "root", kind: "seat" },
    { id: "s1", parentId: "parent", kind: "seat" },
    { id: "s2", parentId: "parent", kind: "seat" },
    { id: "s3", parentId: "parent", kind: "seat" },
    { id: "s4", parentId: "parent", kind: "seat" },
    { id: "s5", parentId: "parent", kind: "seat" },
    { id: "mgr", parentId: "parent", kind: "seat" },
    { id: "mgr-kid", parentId: "mgr", kind: "seat" },
  ];

  it("spaces grid columns evenly (base must not drift after the first child)", () => {
    const { nodes } = layoutRows(rows);
    const byId = new Map(nodes.map((n) => [n.data.id, n]));
    const row0 = ["s1", "s2", "s3"]
      .map((id) => byId.get(id)!)
      .sort((a, b) => a.x - b.x);
    const gap1 = row0[1]!.x - row0[0]!.x;
    const gap2 = row0[2]!.x - row0[1]!.x;
    expect(gap1).toBeCloseTo(gap2, 6);
    expect(gap1).toBeCloseTo(EXTENT / GRID_COLUMNS, 6);
  });

  it("keeps every grid card inside the box flextree allocated for the grid", () => {
    const { nodes, gridBox } = layoutRows(rows);
    const byId = new Map(nodes.map((n) => [n.data.id, n]));
    for (const id of ["s1", "s2", "s3", "s4", "s5"]) {
      const n = byId.get(id)!;
      // ±10 covers the library's small centre-under-parent nudge.
      expect(n.x - NODE_W / 2).toBeGreaterThanOrEqual(gridBox[0] - 10);
      expect(n.x + NODE_W / 2).toBeLessThanOrEqual(gridBox[1] + 10);
    }
  });

  it("never overlaps two cards", () => {
    const { nodes } = layoutRows(rows);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const overlap =
          a.x - NODE_W / 2 < b.x + NODE_W / 2 - 1 &&
          b.x - NODE_W / 2 < a.x + NODE_W / 2 - 1 &&
          a.y < b.y + NODE_H - 1 &&
          b.y < a.y + NODE_H - 1;
        expect(overlap, `${a.data.id} overlaps ${b.data.id}`).toBe(false);
      }
    }
  });

  // Pure leaf grid: bus at the grid box's centre, in the gutter above the
  // first row (not on the card tops). (A left-edge bus was tried on 2026-08-19
  // and reverted: long horizontals along every row plus a far-left elbow
  // trunk read as tangled.)
  it("routes a pure leaf-grid link bus to the grid box's centre", () => {
    const leafOnly: TestRow[] = [
      { id: "root", parentId: "", kind: "seat" },
      { id: "parent", parentId: "root", kind: "seat" },
      { id: "s1", parentId: "parent", kind: "seat" },
      { id: "s2", parentId: "parent", kind: "seat" },
      { id: "s3", parentId: "parent", kind: "seat" },
      { id: "s4", parentId: "parent", kind: "seat" },
      { id: "s5", parentId: "parent", kind: "seat" },
    ];
    const { nodes, chart } = layoutRows(leafOnly);
    const byId = new Map(nodes.map((n) => [n.data.id, n]));
    const bindings = chart.getChartState().layoutBindings.top as unknown as {
      compactLinkMidX: (node: LayoutNode) => number;
      compactLinkMidY: (node: LayoutNode) => number;
    };
    const s1 = byId.get("s1")!;
    const extent = s1.flexCompactDim![0];
    expect(bindings.compactLinkMidX(s1)).toBeCloseTo(
      s1.x + extent * (0.5 - 0.5 / GRID_COLUMNS),
      6,
    );
    const parent = byId.get("parent")!;
    const busY = bindings.compactLinkMidY(s1);
    expect(busY).toBeLessThan(s1.y);
    expect(busY).toBeGreaterThan(parent.y + parent.height);
    expect(bindings.compactLinkMidX(parent)).toBe(parent.x);
    expect(bindings.compactLinkMidY(parent)).toBe(parent.y);
  });

  // Mixed leaf-grid + manager: trunk at the parent centre so one stem leaves
  // the parent (stock/grid-centre trunks stacked as multiple connectors).
  it("trunks mixed leaf-grid links at the parent centre", () => {
    const { nodes, chart } = layoutRows(rows);
    const byId = new Map(nodes.map((n) => [n.data.id, n]));
    const parent = byId.get("parent")!;
    const s1 = byId.get("s1")!;
    const bindings = chart.getChartState().layoutBindings.top as unknown as {
      compactLinkMidX: (node: LayoutNode) => number;
      compactLinkMidY: (node: LayoutNode) => number;
      linkCompactXStart: (node: LayoutNode) => number;
      linkCompactYStart: (node: LayoutNode) => number;
      diagonal: (
        s: { x: number; y: number },
        t: { x: number; y: number },
        m?: { x: number; y: number } | null,
      ) => string;
    };
    const busY = bindings.compactLinkMidY(s1);
    const path = bindings.diagonal(
      {
        x: bindings.compactLinkMidX(s1),
        y: busY,
      },
      { x: parent.x, y: parent.y + parent.height },
      {
        x: bindings.linkCompactXStart(s1),
        y: bindings.linkCompactYStart(s1),
      },
    );
    expect(path).toContain(`${parent.x} ${busY}`);
  });
});

/**
 * Sibling-order stability. The
 * library's expand/collapse only swaps children/_children and flextree never
 * reorders, so x-order must survive any toggle sequence. Guards against
 * regressions like the pre-fix bundle's apparent reordering on expand.
 */
type ToggleNode = LayoutNode & { _children?: LayoutNode[] | null };

function makeRelayout(allRows: TestRow[]) {
  const chart = new GridOrgChart<TestRow>()
    .nodeWidth(() => NODE_W)
    .nodeHeight(() => NODE_H);
  const root = stratify<TestRow>()
    .id((d) => d.id)
    .parentId((d) => (d.parentId === "" ? null : d.parentId))(allRows) as LayoutNode;
  root.each((node) => {
    const n = node as LayoutNode;
    n.width = NODE_W;
    n.height = NODE_H;
  });
  const layout = flextree<TestRow>({
    nodeSize: (node) => {
      const n = node as unknown as LayoutNode;
      return (
        n.flexCompactDim ?? [
          NODE_W + SIBLINGS_MARGIN,
          NODE_H + childrenMarginFor(n, NODE_H),
        ]
      );
    },
    spacing: (a, b) => (a.parent === b.parent ? 0 : NEIGHBOUR_MARGIN),
  });
  return {
    root,
    chart,
    relayout() {
      chart.calculateCompactFlexDimensions(root as unknown as ChartNode<TestRow>);
      layout(root);
      chart.calculateCompactFlexPositions(root as unknown as ChartNode<TestRow>);
    },
  };
}

// Same swap the library's onButtonClick performs.
function toggle(node: ToggleNode) {
  if (node.children) {
    node._children = node.children;
    node.children = undefined;
  } else {
    node.children = node._children ?? undefined;
    node._children = null;
  }
}

describe("GridOrgChart sibling order stability", () => {
  // "b" is expandable (4 leaf seats that grid-wrap); a/c/d are plain headers.
  const toggleRows: TestRow[] = [
    { id: "root", parentId: "", kind: "seat" },
    { id: "p", parentId: "root", kind: "seat" },
    { id: "a", parentId: "p", kind: "header" },
    { id: "b", parentId: "p", kind: "header" },
    { id: "c", parentId: "p", kind: "header" },
    { id: "d", parentId: "p", kind: "header" },
    { id: "b1", parentId: "b", kind: "seat" },
    { id: "b2", parentId: "b", kind: "seat" },
    { id: "b3", parentId: "b", kind: "seat" },
    { id: "b4", parentId: "b", kind: "seat" },
  ];

  it("keeps sibling x-order identical across expand/collapse toggles", () => {
    const { root, relayout } = makeRelayout(toggleRows);
    const p = root.children![0]! as ToggleNode;
    const b = p.children!.find((n) => n.data.id === "b")! as ToggleNode;
    const order = () =>
      (p.children ?? [])
        .slice()
        .sort((x, y) => x.x - y.x)
        .map((n) => n.data.id);

    toggle(b); // start collapsed
    relayout();
    expect(order()).toEqual(["a", "b", "c", "d"]);

    toggle(b); // expand: b's seats grid-wrap, siblings keep their slots
    relayout();
    expect(order()).toEqual(["a", "b", "c", "d"]);

    toggle(b); // collapse again
    relayout();
    expect(order()).toEqual(["a", "b", "c", "d"]);
  });
});

/**
 * Grid slot reservation (2026-08-19 overlap report): a header whose leaf seats
 * grid-wrap sits between collapsed (leaf) siblings. flextree separates sibling
 * subtrees level-by-level and stops at the shallower subtree's contour, so a
 * grid extent carried only on the first grid child (one level below the
 * header) is invisible to the immediate neighbours — they are placed one
 * card-width away and the grid cards spill into their slots (reproduced on the
 * real tree: "Data & Automation"'s seats overlapped "PM" and "AI Dealing &
 * Risk Management"). The grid parent must carry the grid width itself.
 */
describe("GridOrgChart grid slot reservation", () => {
  const rows: TestRow[] = [
    { id: "root", parentId: "", kind: "seat" },
    { id: "p", parentId: "root", kind: "seat" },
    { id: "left", parentId: "p", kind: "header" },
    { id: "grid", parentId: "p", kind: "header" },
    { id: "right", parentId: "p", kind: "header" },
    { id: "g1", parentId: "grid", kind: "seat" },
    { id: "g2", parentId: "grid", kind: "seat" },
    { id: "g3", parentId: "grid", kind: "seat" },
  ];

  it("carries the grid width on the grid parent, not just the first child", () => {
    const { nodes } = layoutRows(rows);
    const grid = nodes.find((n) => n.data.id === "grid")!;
    expect(grid.flexCompactDim?.[0]).toBeGreaterThanOrEqual(EXTENT);
  });

  it("keeps neighbouring cards clear of the grid cards", () => {
    const { nodes } = layoutRows(rows);
    const byId = new Map(nodes.map((n) => [n.data.id, n]));
    const left = byId.get("left")!;
    const right = byId.get("right")!;
    const g1 = byId.get("g1")!; // leftmost grid card (col 0)
    const g3 = byId.get("g3")!; // rightmost grid card (col 2)
    // Card-edge clearance (1px tolerance for float noise).
    expect(g1.x - NODE_W / 2).toBeGreaterThanOrEqual(left.x + NODE_W / 2 - 1);
    expect(g3.x + NODE_W / 2).toBeLessThanOrEqual(right.x - NODE_W / 2 + 1);
  });
});

/**
 * Phantom-grid regression (2026-08-19 "sibling reorder" report): grid parents
 * carry a flexCompactDim for slot reservation, but they are NOT grid members —
 * membership is marked by firstCompactNode. Filtering compact children on
 * flexCompactDim truthiness swept the parent into a phantom grid: its x drifted
 * one column per relayout, and two expanded grid parents collapsed onto the
 * same x, scrambling the visual sibling order.
 */
describe("GridOrgChart phantom-grid guard", () => {
  const rows: TestRow[] = [
    { id: "root", parentId: "", kind: "seat" },
    { id: "p", parentId: "root", kind: "seat" },
    { id: "h1", parentId: "p", kind: "header" },
    { id: "g1", parentId: "p", kind: "header" },
    { id: "h2", parentId: "p", kind: "header" },
    { id: "g2", parentId: "p", kind: "header" },
    { id: "h3", parentId: "p", kind: "header" },
    { id: "a1", parentId: "g1", kind: "seat" },
    { id: "a2", parentId: "g1", kind: "seat" },
    { id: "a3", parentId: "g1", kind: "seat" },
    { id: "b1", parentId: "g2", kind: "seat" },
    { id: "b2", parentId: "g2", kind: "seat" },
    { id: "b3", parentId: "g2", kind: "seat" },
  ];

  it("keeps two expanded grid parents at distinct, stable x across relayouts", () => {
    const { root, relayout } = makeRelayout(rows);
    relayout();
    const byId = () =>
      new Map((root.children![0]!.children ?? []).map((n) => [n.data.id, n.x]));
    const first = byId();
    expect(first.get("g1")).not.toBe(first.get("g2"));

    relayout(); // identical tree: positions must not drift
    const second = byId();
    for (const [id, x] of first) {
      expect(second.get(id)).toBeCloseTo(x!, 6);
    }
  });

  it("centres each grid under its own parent", () => {
    const { root, relayout } = makeRelayout(rows);
    relayout();
    for (const gid of ["g1", "g2"]) {
      const parent = root.children![0]!.children!.find((n) => n.data.id === gid)!;
      const kids = parent.children ?? [];
      const mid =
        (Math.min(...kids.map((k) => k.x)) + Math.max(...kids.map((k) => k.x))) / 2;
      expect(mid).toBeCloseTo(parent.x, 0);
    }
  });
});

/**
 * Header section reservation (2026-08-19 wide-bar overlap report): a header
 * reserves its visible subtree's full width as its level-0 slot. Without it,
 * collapsed siblings only clear the header's card-width slot, so their cards
 * tuck into the section's x-range and anything drawn across the section
 * covers them (reproduced on the real tree: "Security & AI" spanned 2260px
 * over a 280px slot and overlapped 5 depth-2 siblings). Grid-parent headers
 * were already covered by the grid slot reservation; this guards headers
 * whose width comes from non-grid descendants (sub-headers, seats with
 * reports). The card itself stays standard width — the reservation is empty
 * space around it.
 */
describe("GridOrgChart header section reservation", () => {
  // "wide" -> mgr (non-leaf seat) -> 3 collapsed headers. No grid anywhere:
  // the section's width comes purely from non-grid descendants.
  const rows: TestRow[] = [
    { id: "root", parentId: "", kind: "seat" },
    { id: "wide", parentId: "root", kind: "header" },
    { id: "next", parentId: "root", kind: "header" },
    { id: "mgr", parentId: "wide", kind: "seat" },
    { id: "h1", parentId: "mgr", kind: "header" },
    { id: "h2", parentId: "mgr", kind: "header" },
    { id: "h3", parentId: "mgr", kind: "header" },
  ];

  it("reserves the non-grid subtree width on the header's own slot", () => {
    const { root, relayout } = makeRelayout(rows);
    relayout();
    const byId = new Map(
      (root.descendants() as LayoutNode[]).map((n) => [n.data.id, n]),
    );
    const wide = byId.get("wide")!;
    // The reservation must cover the three child headers' slots contiguously
    // (without it, "wide" keeps a single card-width slot).
    const childSlots = ["h1", "h2", "h3"].reduce(
      (s, id) => s + (byId.get(id)!.subtreeExtent ?? 0),
      0,
    );
    expect(childSlots).toBeGreaterThan(NODE_W + SIBLINGS_MARGIN);
    expect(wide.flexCompactDim?.[0]).toBeGreaterThanOrEqual(childSlots);
  });

  it("keeps the collapsed sibling's card outside the section span", () => {
    const { root, relayout } = makeRelayout(rows);
    relayout();
    const byId = new Map(
      (root.descendants() as LayoutNode[]).map((n) => [n.data.id, n]),
    );
    const next = byId.get("next")!;
    const h3 = byId.get("h3")!; // rightmost card inside the section
    expect(next.x - NODE_W / 2).toBeGreaterThanOrEqual(h3.x + NODE_W / 2 - 1);
  });

  it("keeps the header card centred over its children", () => {
    const { root, relayout } = makeRelayout(rows);
    relayout();
    const byId = new Map(
      (root.descendants() as LayoutNode[]).map((n) => [n.data.id, n]),
    );
    const wide = byId.get("wide")!;
    const mgr = byId.get("mgr")!;
    expect(wide.x).toBeCloseTo(mgr.x, 0);
  });
});

/**
 * Rigid sections (2026-08-19 "space on the wrong side" report): every parent —
 * seat or header — reserves its visible subtree's full width as its slot, so
 * each subtree is a rigid rectangle that its children fill exactly. Reserving
 * only headers left interleaving intact under seats: the estimate's slack
 * piled up on the side opposite the expanded child, so an expanded first
 * sibling's content hugged the previous section while a dead gap opened on
 * the other side. With rigid sections the bottom-up sum is exact (flextree
 * centres a parent over its children's slot span, so content and reservation
 * align) and section gaps are symmetric.
 */
describe("GridOrgChart rigid sections", () => {
  // Mirrors the Deveraj/Robin/Victor shape on the real tree: the "mid"
  // section has three seat children, the first expanded (three header kids),
  // the others collapsed.
  const rows: TestRow[] = [
    { id: "root", parentId: "", kind: "seat" },
    { id: "prev", parentId: "root", kind: "header" },
    { id: "mid", parentId: "root", kind: "header" },
    { id: "next", parentId: "root", kind: "header" },
    { id: "p1", parentId: "prev", kind: "seat" },
    { id: "n1", parentId: "next", kind: "seat" },
    { id: "d", parentId: "mid", kind: "seat" },
    { id: "r", parentId: "mid", kind: "seat" },
    { id: "v", parentId: "mid", kind: "seat" },
    { id: "k1", parentId: "d", kind: "header" },
    { id: "k2", parentId: "d", kind: "header" },
    { id: "k3", parentId: "d", kind: "header" },
  ];
  const SLOT = NODE_W + SIBLINGS_MARGIN;

  it("reserves the subtree extent on every parent, seat or header", () => {
    const { root, relayout } = makeRelayout(rows);
    relayout();
    const byId = new Map(
      (root.descendants() as LayoutNode[]).map((n) => [n.data.id, n]),
    );
    expect(byId.get("d")!.flexCompactDim?.[0]).toBeCloseTo(3 * SLOT, 6);
    // r and v are leaf seats, so they grid-wrap: a 2-seat grid gets a box of
    // exactly 2 columns (no phantom third column as dead space).
    const gridBox = 2 * NODE_W + COMPACT_MARGIN_PAIR;
    expect(byId.get("mid")!.flexCompactDim?.[0]).toBeCloseTo(3 * SLOT + gridBox, 6);
  });

  it("separates sections symmetrically — no slack on either side", () => {
    const { root, relayout } = makeRelayout(rows);
    relayout();
    const byId = new Map(
      (root.descendants() as LayoutNode[]).map((n) => [n.data.id, n]),
    );
    const gapLeft = byId.get("k1")!.x - NODE_W / 2 - (byId.get("p1")!.x + NODE_W / 2);
    const gapRight = byId.get("n1")!.x - NODE_W / 2 - (byId.get("v")!.x + NODE_W / 2);
    // Contour separation between two sections uses the neighbour margin (the
    // contour nodes are deep, so different-parent spacing applies): the
    // designed gap is neighbourMargin + the two in-slot card margins. A grid
    // edge pads its cards by up to one grid-column padding more than a plain
    // slot edge, so exact equality is impossible — the invariant is that no
    // side carries significant slack (pre-rigid, one side carried ~290px).
    const designed = NEIGHBOUR_MARGIN + SIBLINGS_MARGIN;
    expect(Math.min(gapLeft, gapRight)).toBeGreaterThanOrEqual(designed - 1);
    expect(Math.max(gapLeft, gapRight)).toBeLessThanOrEqual(designed + 30);
    expect(Math.abs(gapLeft - gapRight)).toBeLessThanOrEqual(30);
  });

  it("never overlaps two cards", () => {
    const { root, relayout } = makeRelayout(rows);
    relayout();
    const nodes = root.descendants() as LayoutNode[];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const overlap =
          a.x - a.width / 2 < b.x + b.width / 2 - 1 &&
          b.x - b.width / 2 < a.x + a.width / 2 - 1 &&
          a.y < b.y + b.height - 1 &&
          b.y < a.y + a.height - 1;
        expect(overlap, `${a.data.id} overlaps ${b.data.id}`).toBe(false);
      }
    }
  });
});

describe("GridOrgChart assistant pin", () => {
  it("keeps the assistant out of the compact grid and on the parent trunk", () => {
    const rows: TestRow[] = [
      { id: "root", parentId: "", kind: "seat" },
      { id: "parent", parentId: "root", kind: "seat" },
      { id: "asst", parentId: "parent", kind: "seat", isAssistant: true },
      { id: "s1", parentId: "parent", kind: "seat" },
      { id: "s2", parentId: "parent", kind: "seat" },
      { id: "s3", parentId: "parent", kind: "seat" },
    ];
    const { nodes } = layoutRows(rows);
    const byId = new Map(nodes.map((n) => [n.data.id, n]));
    expect(byId.get("asst")!.firstCompactNode).toBeFalsy();
    expect(byId.get("s1")!.firstCompactNode).toBeTruthy();
    const parent = byId.get("parent")!;
    const asst = byId.get("asst")!;
    expect(asst.x).toBeCloseTo(parent.x + NODE_W * 0.7, 0);
    expect(Math.abs(asst.x - parent.x)).toBeLessThan(NODE_W);
  });

  it("joins the assistant on the left-middle, not the top", () => {
    const rows: TestRow[] = [
      { id: "root", parentId: "", kind: "seat" },
      { id: "parent", parentId: "root", kind: "seat" },
      { id: "asst", parentId: "parent", kind: "seat", isAssistant: true },
      { id: "s1", parentId: "parent", kind: "seat" },
      { id: "s2", parentId: "parent", kind: "seat" },
      { id: "s3", parentId: "parent", kind: "seat" },
    ];
    const { nodes, chart } = layoutRows(rows);
    const byId = new Map(nodes.map((n) => [n.data.id, n]));
    const bindings = chart.getChartState().layoutBindings.top as unknown as {
      linkX: (node: LayoutNode) => number;
      linkY: (node: LayoutNode) => number;
    };
    const asst = byId.get("asst")!;
    const s1 = byId.get("s1")!;
    expect(bindings.linkX(asst)).toBeCloseTo(asst.x - asst.width / 2, 6);
    expect(bindings.linkY(asst)).toBeCloseTo(asst.y + asst.height / 2, 6);
    expect(bindings.linkX(s1)).toBe(s1.x);
    expect(bindings.linkY(s1)).toBe(s1.y);
  });

  it("opens extra parent-to-child gap so the assistant does not overlap the team row", () => {
    const team = [
      { id: "root", parentId: "" as const, kind: "seat" as const },
      { id: "parent", parentId: "root" as const, kind: "seat" as const },
      { id: "s1", parentId: "parent" as const, kind: "seat" as const },
      { id: "s2", parentId: "parent" as const, kind: "seat" as const },
      { id: "s3", parentId: "parent" as const, kind: "seat" as const },
    ];
    const without = layoutRows(team);
    const withAsst = layoutRows([
      ...team,
      { id: "asst", parentId: "parent", kind: "seat", isAssistant: true },
    ]);
    const gap = (nodes: LayoutNode[]) => {
      const byId = new Map(nodes.map((n) => [n.data.id, n]));
      return byId.get("s1")!.y - byId.get("parent")!.y;
    };
    expect(gap(withAsst.nodes)).toBeGreaterThan(
      gap(without.nodes) + NODE_H + ASSISTANT_TRUNK_GUTTER - 1,
    );

    const byId = new Map(withAsst.nodes.map((n) => [n.data.id, n]));
    const asst = byId.get("asst")!;
    for (const id of ["s1", "s2", "s3"]) {
      const child = byId.get(id)!;
      const overlapX =
        asst.x - asst.width / 2 < child.x + child.width / 2 - 1 &&
        child.x - child.width / 2 < asst.x + asst.width / 2 - 1;
      const overlapY =
        asst.y - asst.height / 2 < child.y + child.height / 2 - 1 &&
        child.y - child.height / 2 < asst.y + asst.height / 2 - 1;
      expect(overlapX && overlapY, `${id} overlaps assistant`).toBe(false);
    }
  });

  it("buses team-child links below the assistant card", () => {
    const rows: TestRow[] = [
      { id: "root", parentId: "", kind: "seat" },
      { id: "parent", parentId: "root", kind: "seat" },
      { id: "asst", parentId: "parent", kind: "seat", isAssistant: true },
      { id: "s1", parentId: "parent", kind: "seat" },
      { id: "s2", parentId: "parent", kind: "seat" },
      { id: "s3", parentId: "parent", kind: "seat" },
    ];
    const { nodes, chart } = layoutRows(rows);
    const byId = new Map(nodes.map((n) => [n.data.id, n]));
    const bindings = chart.getChartState().layoutBindings.top as unknown as {
      compactLinkMidY: (node: LayoutNode) => number;
    };
    const asst = byId.get("asst")!;
    const s1 = byId.get("s1")!;
    const busY = bindings.compactLinkMidY(s1);
    expect(busY).toBeLessThan(s1.y);
    expect(busY).toBeGreaterThan(asst.y + asst.height / 2);
  });
});

/**
 * Collapsed managers are not leaves: d3 parks
 * their reports on `_children`, so `!d.children` alone packed them into the
 * 3-column grid. Four Engineering directs then wrapped 3+1 and the 4th card
 * sat under column 0 with a drop from the parent bus.
 */
describe("GridOrgChart collapsed managers stay in one row", () => {
  const managerRows: TestRow[] = [
    { id: "root", parentId: "", kind: "seat" },
    { id: "eng", parentId: "root", kind: "header" },
    { id: "m1", parentId: "eng", kind: "seat" },
    { id: "m2", parentId: "eng", kind: "seat" },
    { id: "m3", parentId: "eng", kind: "seat" },
    { id: "m4", parentId: "eng", kind: "seat" },
    { id: "m1k", parentId: "m1", kind: "seat" },
    { id: "m2k", parentId: "m2", kind: "seat" },
    { id: "m3k", parentId: "m3", kind: "seat" },
    { id: "m4k", parentId: "m4", kind: "seat" },
  ];

  function layoutCollapsedManagers() {
    const { root, relayout } = makeRelayout(managerRows);
    for (const id of ["m1", "m2", "m3", "m4"]) {
      const node = (root.descendants() as ToggleNode[]).find((n) => n.data.id === id)!;
      toggle(node);
    }
    relayout();
    return root.descendants() as LayoutNode[];
  }

  it("does not grid-wrap four collapsed managers", () => {
    const nodes = layoutCollapsedManagers();
    const byId = new Map(nodes.map((n) => [n.data.id, n]));
    for (const id of ["m1", "m2", "m3", "m4"]) {
      expect(byId.get(id)!.firstCompactNode, id).toBeFalsy();
    }
  });

  it("keeps four collapsed managers on one row spanning four slots", () => {
    const nodes = layoutCollapsedManagers();
    const byId = new Map(nodes.map((n) => [n.data.id, n]));
    const managers = ["m1", "m2", "m3", "m4"].map((id) => byId.get(id)!);
    const ys = managers.map((n) => n.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1);
    const xs = managers.map((n) => n.x).sort((a, b) => a - b);
    expect(xs[3]! - xs[0]!).toBeCloseTo(3 * (NODE_W + SIBLINGS_MARGIN), 0);
    const eng = byId.get("eng")!;
    expect(eng.flexCompactDim?.[0]).toBeGreaterThan(EXTENT);
  });
});

describe("GridOrgChart mixed collapsed managers and leaves", () => {
  const mixedRows: TestRow[] = [
    { id: "root", parentId: "", kind: "seat" },
    { id: "parent", parentId: "root", kind: "seat" },
    { id: "s1", parentId: "parent", kind: "seat" },
    { id: "s2", parentId: "parent", kind: "seat" },
    { id: "s3", parentId: "parent", kind: "seat" },
    { id: "s4", parentId: "parent", kind: "seat" },
    { id: "s5", parentId: "parent", kind: "seat" },
    { id: "mgr1", parentId: "parent", kind: "seat" },
    { id: "mgr2", parentId: "parent", kind: "seat" },
    { id: "mgr1-kid", parentId: "mgr1", kind: "seat" },
    { id: "mgr2-kid", parentId: "mgr2", kind: "seat" },
  ];

  it("grids only the five leaves; collapsed managers stay out", () => {
    const { root, relayout } = makeRelayout(mixedRows);
    for (const id of ["mgr1", "mgr2"]) {
      const node = (root.descendants() as ToggleNode[]).find((n) => n.data.id === id)!;
      toggle(node);
    }
    relayout();
    const byId = new Map(
      (root.descendants() as LayoutNode[]).map((n) => [n.data.id, n]),
    );
    for (const id of ["s1", "s2", "s3", "s4", "s5"]) {
      expect(byId.get(id)!.firstCompactNode, id).toBeTruthy();
    }
    expect(byId.get("s4")!.row).toBe(1);
    expect(byId.get("s5")!.row).toBe(1);
    expect(byId.get("mgr1")!.firstCompactNode).toBeFalsy();
    expect(byId.get("mgr2")!.firstCompactNode).toBeFalsy();
  });

  it("aligns manager link bus Y with the leaf-grid gutter", () => {
    const rows: TestRow[] = [
      { id: "root", parentId: "", kind: "seat" },
      { id: "parent", parentId: "root", kind: "seat" },
      { id: "s1", parentId: "parent", kind: "seat" },
      { id: "s2", parentId: "parent", kind: "seat" },
      { id: "s3", parentId: "parent", kind: "seat" },
      { id: "mgr", parentId: "parent", kind: "seat" },
      { id: "mgr-kid", parentId: "mgr", kind: "seat" },
    ];
    const { nodes, chart } = layoutRows(rows);
    const byId = new Map(nodes.map((n) => [n.data.id, n]));
    const parent = byId.get("parent")!;
    const s1 = byId.get("s1")!;
    const mgr = byId.get("mgr")!;
    expect(s1.firstCompactNode).toBeTruthy();
    expect(mgr.firstCompactNode).toBeFalsy();
    // Expanded managers carry flexCompactDim (section reservation), so the
    // library draws their parent link via compactLinkMid* — not linkX.
    expect(mgr.flexCompactDim).toBeTruthy();

    const bindings = chart.getChartState().layoutBindings.top as unknown as {
      compactLinkMidX: (node: LayoutNode) => number;
      compactLinkMidY: (node: LayoutNode) => number;
      linkCompactXStart: (node: LayoutNode) => number;
      linkCompactYStart: (node: LayoutNode) => number;
      diagonal: (
        s: { x: number; y: number },
        t: { x: number; y: number },
        m?: { x: number; y: number } | null,
      ) => string;
    };

    const gridBusY = bindings.compactLinkMidY(s1);
    const parentPt = { x: parent.x, y: parent.y + parent.height };
    const mgrPath = bindings.diagonal(
      {
        x: bindings.compactLinkMidX(mgr),
        y: bindings.compactLinkMidY(mgr),
      },
      parentPt,
      {
        x: bindings.linkCompactXStart(mgr),
        y: bindings.linkCompactYStart(mgr),
      },
    );
    expect(mgrPath).toContain(` ${gridBusY}`);
    // Mixed grid + manager: both trunk at parent.x (one stem), not grid centre.
    const leafPath = bindings.diagonal(
      {
        x: bindings.compactLinkMidX(s1),
        y: bindings.compactLinkMidY(s1),
      },
      parentPt,
      {
        x: bindings.linkCompactXStart(s1),
        y: bindings.linkCompactYStart(s1),
      },
    );
    expect(mgrPath).toContain(`${parent.x} ${gridBusY}`);
    expect(leafPath).toContain(`${parent.x} ${gridBusY}`);
  });

  it("shares one parent-centre trunk for expanded and collapsed managers", () => {
    const rows: TestRow[] = [
      { id: "root", parentId: "", kind: "seat" },
      { id: "parent", parentId: "root", kind: "seat" },
      { id: "collapsed", parentId: "parent", kind: "seat" },
      { id: "collapsed-kid", parentId: "collapsed", kind: "seat" },
      { id: "expanded", parentId: "parent", kind: "seat" },
      { id: "expanded-kid", parentId: "expanded", kind: "seat" },
      { id: "leaf", parentId: "parent", kind: "seat" },
    ];
    const { root, relayout, chart } = makeRelayout(rows);
    const collapsed = (root.descendants() as ToggleNode[]).find(
      (n) => n.data.id === "collapsed",
    )!;
    toggle(collapsed);
    relayout();
    const byId = new Map(
      (root.descendants() as LayoutNode[]).map((n) => [n.data.id, n]),
    );
    const parent = byId.get("parent")!;
    const col = byId.get("collapsed")!;
    const exp = byId.get("expanded")!;
    expect(col.firstCompactNode).toBeFalsy();
    expect(exp.firstCompactNode).toBeFalsy();
    expect(exp.flexCompactDim).toBeTruthy();

    const bindings = chart.getChartState().layoutBindings.top as unknown as {
      linkX: (node: LayoutNode) => number;
      linkY: (node: LayoutNode) => number;
      compactLinkMidX: (node: LayoutNode) => number;
      compactLinkMidY: (node: LayoutNode) => number;
      linkCompactXStart: (node: LayoutNode) => number;
      linkCompactYStart: (node: LayoutNode) => number;
      diagonal: (
        s: { x: number; y: number },
        t: { x: number; y: number },
        m?: { x: number; y: number } | null,
      ) => string;
    };
    const parentPt = { x: parent.x, y: parent.y + parent.height };
    // Collapsed manager: no flexCompactDim → linkX path.
    const colPath = bindings.diagonal(
      { x: bindings.linkX(col), y: bindings.linkY(col) },
      parentPt,
    );
    // Expanded manager: compactLinkMid path.
    const expPath = bindings.diagonal(
      {
        x: bindings.compactLinkMidX(exp),
        y: bindings.compactLinkMidY(exp),
      },
      parentPt,
      {
        x: bindings.linkCompactXStart(exp),
        y: bindings.linkCompactYStart(exp),
      },
    );
    const busY = col.y - CHILDREN_MARGIN / 2;
    expect(colPath).toContain(`${parent.x} ${busY}`);
    expect(expPath).toContain(`${parent.x} ${busY}`);
  });
});

describe("GridOrgChart first-row-only parent drops", () => {
  type TopBindings = {
    compactLinkMidX: (node: LayoutNode) => number;
    compactLinkMidY: (node: LayoutNode) => number;
    linkCompactXStart: (node: LayoutNode) => number;
    linkCompactYStart: (node: LayoutNode) => number;
    diagonal: (
      s: { x: number; y: number },
      t: { x: number; y: number },
      m?: { x: number; y: number } | null,
    ) => string;
  };

  function gridPath(
    chart: GridOrgChart<TestRow>,
    child: LayoutNode,
    parent: LayoutNode,
  ) {
    const bindings = chart.getChartState().layoutBindings.top as unknown as TopBindings;
    // Library compact call is diagonal(bus, parent, childStart) — see d3-org-chart
    // linkUpdate: n = compactLinkMid*, p = linkParent*, m = linkCompact*Start.
    const bus = {
      x: bindings.compactLinkMidX(child),
      y: bindings.compactLinkMidY(child),
    };
    return {
      path: bindings.diagonal(
        bus,
        { x: parent.x, y: parent.y },
        { x: bindings.linkCompactXStart(child), y: bindings.linkCompactYStart(child) },
      ),
      midX: bus.x,
    };
  }

  const leafRows: TestRow[] = [
    { id: "root", parentId: "", kind: "seat" },
    { id: "parent", parentId: "root", kind: "seat" },
    { id: "s1", parentId: "parent", kind: "seat" },
    { id: "s2", parentId: "parent", kind: "seat" },
    { id: "s3", parentId: "parent", kind: "seat" },
    { id: "s4", parentId: "parent", kind: "seat" },
    { id: "s5", parentId: "parent", kind: "seat" },
  ];

  it("connects only the first grid row to the parent bus", () => {
    const { nodes, chart } = layoutRows(leafRows);
    const byId = new Map(nodes.map((n) => [n.data.id, n]));
    const parent = byId.get("parent")!;
    const s1 = byId.get("s1")!;
    const s4 = byId.get("s4")!;
    expect(s1.row ?? 0).toBe(0);
    expect(s4.row).toBe(1);
    const row0 = gridPath(chart, s1, parent);
    const row1 = gridPath(chart, s4, parent);
    expect(row0.path).toContain(`${row0.midX} ${parent.y}`);
    expect(row1.path.startsWith("M ")).toBe(true);
    expect(row1.path).not.toContain(`L`);
    expect(row1.path).not.toContain(`${parent.y}`);
  });
});

describe("GridOrgChart per-parent leafGridColumns", () => {
  function layoutWithParentCap(parentCap: number, leafCount: number) {
    const rows: TestRow[] = [
      { id: "root", parentId: "", kind: "seat", leafGridColumns: 3 },
      {
        id: "parent",
        parentId: "root",
        kind: "seat",
        leafGridColumns: parentCap,
      },
    ];
    for (let i = 1; i <= leafCount; i++) {
      rows.push({ id: `s${i}`, parentId: "parent", kind: "seat" });
    }
    return layoutRows(rows);
  }

  it("wraps five leaves into three rows when parent cap is 2", () => {
    const { nodes } = layoutWithParentCap(2, 5);
    const byId = new Map(nodes.map((n) => [n.data.id, n]));
    expect(byId.get("s1")!.row).toBe(0);
    expect(byId.get("s2")!.row).toBe(0);
    expect(byId.get("s3")!.row).toBe(1);
    expect(byId.get("s4")!.row).toBe(1);
    expect(byId.get("s5")!.row).toBe(2);
    expect(byId.get("s5")!.col).toBe(0);
  });

  it("stacks five leaves in one column when parent cap is 1", () => {
    const { nodes } = layoutWithParentCap(1, 5);
    const byId = new Map(nodes.map((n) => [n.data.id, n]));
    for (let i = 1; i <= 5; i++) {
      expect(byId.get(`s${i}`)!.col ?? 0).toBe(0);
      expect(byId.get(`s${i}`)!.row).toBe(i - 1);
    }
    const xs = new Set(["s1", "s2", "s3", "s4", "s5"].map((id) => byId.get(id)!.x));
    expect(xs.size).toBe(1);
  });

  it("keeps five leaves on one row when parent cap is 5", () => {
    const { nodes } = layoutWithParentCap(5, 5);
    const byId = new Map(nodes.map((n) => [n.data.id, n]));
    for (const id of ["s1", "s2", "s3", "s4", "s5"]) {
      expect(byId.get(id)!.row ?? 0).toBe(0);
    }
    const xs = new Set(["s1", "s2", "s3", "s4", "s5"].map((id) => byId.get(id)!.x));
    expect(xs.size).toBe(5);
  });
});
