/**
 * GridOrgChart — d3-org-chart with true leaf children packed into a 3-column
 * grid instead of the library's hard-coded 2. Collapsed managers keep reports
 * on `_children` and stay in one row.
 *
 * The two `calculateCompactFlex*` methods are ports of the library's compact
 * algorithm with the column count parameterised, plus one deliberate
 * deviation: the grid parent itself carries the grid's width in
 * `flexCompactDim` (the stock code nulls it). flextree separates sibling
 * subtrees level-by-level and stops at the shallower contour, so an extent
 * carried only by the first grid child is invisible to the parent's immediate
 * neighbours — their cards overlapped the grid (2026-08-19 report). With the
 * width on the parent, level-0 separation reserves the full grid slot.
 * Everything else (flextree extents via flexCompactDim, paging,
 * expand/collapse) is untouched.
 *
 * Additionally, every parent reserves its visible subtree's full width as its
 * level-0 slot (a post-order extent pass at the end of
 * calculateCompactFlexDimensions), making every subtree a rigid rectangular
 * section: children pack contiguously and fill the parent's slot exactly, so
 * no sibling ever tucks into another section's x-range and section gaps are
 * symmetric. Reserving only headers left the slack asymmetric — expanded
 * content hugged one edge of the estimate while empty space piled up on the
 * other side (2026-08-19 "space on the wrong side" report). Cards render at
 * standard width, centred over their children.
 *
 * The `top` link bindings are also adjusted: the stock versions offset link
 * endpoints ±width/2 based on the 2-column `compactEven` flag, which is wrong
 * for 3 columns. Ours fan from the parent's bottom edge to each card's top
 * centre via a bus in the gutter above each grid row. Assistants join on the
 * left-middle of the card with a short stub off the reporting trunk.
 */

import { cumsum, max, pointer, sum } from "d3";
import { OrgChart, type ChartNode, type ChartState } from "d3-org-chart";

import { expandModeFromEvent, type ExpandMode } from "./expand-chip";

type LinkPt = { x: number; y: number };

/** Matches d3-org-chart's stock vertical `diagonal` (`rdef = 35`). */
const LINK_RADIUS = 35;

function dist(a: LinkPt, b: LinkPt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function dedupePts(pts: LinkPt[]): LinkPt[] {
  const out: LinkPt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.01 || Math.abs(last.y - p.y) > 0.01) {
      out.push(p);
    }
  }
  return out;
}

function roundedOrthPath(pts: LinkPt[], rdef = LINK_RADIUS): string {
  const points = dedupePts(pts);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return "";
  if (points.length === 1) return `M ${first.x} ${first.y}`;
  if (points.length === 2) return `M ${first.x} ${first.y} L ${last.x} ${last.y}`;

  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;
    const dIn = dist(prev, curr);
    const dOut = dist(curr, next);
    const r = Math.min(rdef, dIn / 2, dOut / 2);
    if (r < 0.5) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }
    d += ` L ${curr.x - ((curr.x - prev.x) / dIn) * r} ${curr.y - ((curr.y - prev.y) / dIn) * r}`;
    d += ` Q ${curr.x} ${curr.y} ${curr.x + ((next.x - curr.x) / dOut) * r} ${curr.y + ((next.y - curr.y) / dOut) * r}`;
  }
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function assistantLinkPath(s: LinkPt, t: LinkPt): string {
  return roundedOrthPath([s, { x: t.x, y: s.y }, t]);
}

/** Library compact call is diagonal(bus, parent, childStart). */
function gridChildLinkPath(bus: LinkPt, parent: LinkPt, child: LinkPt): string {
  return roundedOrthPath([
    child,
    { x: child.x, y: bus.y },
    bus,
    { x: bus.x, y: parent.y },
    parent,
  ]);
}

function teamChildren<D extends GridRowData>(
  parent: ChartNode<D> | null | undefined,
): ChartNode<D>[] {
  return teamKids(parent?.children);
}

/** Gutter Y above the child row — shared by every team sibling under a parent. */
function sharedTeamBusY<D extends GridRowData>(node: ChartNode<D>): number | null {
  const team = teamChildren(node.parent);
  if (team.length < 2) return null;
  const gridFch = team.find((c) => c.firstCompactNode)?.firstCompactNode;
  const rowY = gridFch?.y ?? Math.min(...team.map((c) => c.y));
  return rowY - CHILDREN_MARGIN / 2;
}

/** True when this parent mixes a leaf grid with non-grid team siblings. */
function hasMixedGridSiblings<D extends GridRowData>(
  parent: ChartNode<D> | null | undefined,
): boolean {
  const team = teamChildren(parent);
  return (
    team.some((c) => !!c.firstCompactNode) && team.some((c) => !c.firstCompactNode)
  );
}

export const GRID_COLUMNS = 3;
export const LEAF_GRID_MIN = 1;
export const LEAF_GRID_MAX = 5;

export function leafGridColumnsOf(data: { leafGridColumns?: number }): number {
  const n = data.leafGridColumns ?? GRID_COLUMNS;
  return Math.min(LEAF_GRID_MAX, Math.max(LEAF_GRID_MIN, n));
}
/** d3-org-chart default parent-to-child gap. */
export const CHILDREN_MARGIN = 60;
/** Padding around the assistant card inside the trunk gap. */
export const ASSISTANT_TRUNK_GUTTER = 16;

function teamKids<D extends GridRowData>(
  nodes: ChartNode<D>[] | undefined,
): ChartNode<D>[] {
  return (nodes ?? []).filter((d) => !d.data.isAssistant && !d.data._pagingButton);
}

/** True leaf for N-column packing: seat with no team children, including collapsed. */
export function isCompactLeaf<D extends GridRowData>(node: ChartNode<D>): boolean {
  if (node.data.kind !== "seat" || node.data.isAssistant || node.data._pagingButton) {
    return false;
  }
  return teamKids(node.children).length === 0 && teamKids(node._children).length === 0;
}

export function childrenMarginFor(
  node: { children?: { data: { isAssistant?: boolean } }[] | null },
  assistantHeight: number,
): number {
  if (!node.children?.some((child) => child.data.isAssistant)) {
    return CHILDREN_MARGIN;
  }
  return CHILDREN_MARGIN + assistantHeight + ASSISTANT_TRUNK_GUTTER;
}

interface GridRowData {
  id: string;
  kind: "header" | "seat";
  isAssistant?: boolean;
  leafGridColumns?: number;
  _pagingButton?: boolean;
}

export class GridOrgChart<D extends GridRowData> extends OrgChart<D> {
  onExpandChip?: (nodeId: string, mode: ExpandMode) => void;

  constructor() {
    super();
    this.getChartState().childrenMargin = (node) => {
      const assistant = node.children?.find((child) => child.data.isAssistant);
      if (!assistant) return CHILDREN_MARGIN;
      return childrenMarginFor(node, this.getChartState().nodeHeight(assistant));
    };
    const bindings = this.getChartState().layoutBindings?.top;
    if (bindings) {
      const stockDiagonal = bindings.diagonal;
      let assistantLink = false;
      let gridChildLink = false;
      let gridRow = 0;
      let teamBusY: number | null = null;
      /** When set, grid row-0 links trunk at parent.x (mixed with managers). */
      let gridTrunkAtParent = false;

      bindings.linkX = (node) => {
        assistantLink = !!node.data.isAssistant;
        teamBusY = null;
        gridTrunkAtParent = false;
        if (!assistantLink && !node.firstCompactNode) {
          teamBusY = sharedTeamBusY(node);
        }
        return node.data.isAssistant ? node.x - node.width / 2 : node.x;
      };
      bindings.linkY = (node) =>
        node.data.isAssistant ? node.y + node.height / 2 : node.y;

      bindings.linkCompactXStart = (node) => node.x;
      bindings.linkCompactYStart = (node) => node.y;
      // Grid parents carry flexCompactDim without firstCompactNode; the library
      // routes their links through these bindings, so fall back to the node's
      // own center for them. Pure leaf grids bus to the grid box's centre
      // (`fch.x + extent·(0.5 − 0.5/cols)`). Mixed manager + leaf-grid siblings
      // all trunk at the parent's x instead, so one stem leaves the parent
      // (amended 2026-08-28). Bus Y sits immediately above the child row.
      bindings.compactLinkMidX = (node) => {
        gridChildLink = !!node.firstCompactNode;
        gridRow = node.row ?? 0;
        assistantLink = false;
        teamBusY = null;
        gridTrunkAtParent = false;
        const fch = node.firstCompactNode;
        if (!fch) {
          // Expanded managers carry flexCompactDim (section reservation), so
          // the library routes here instead of linkX. ≥2 team siblings share
          // one gutter bus at the parent centre — stock mid-gap diagonals each
          // draw their own stem and look like multiple connectors.
          if (!node.data.isAssistant) {
            teamBusY = sharedTeamBusY(node);
          }
          return node.x;
        }
        const parent = node.parent;
        if (hasMixedGridSiblings(parent)) {
          // Mixed: join the shared parent trunk (bus x resolved in diagonal).
          gridTrunkAtParent = true;
          return node.x;
        }
        const cap = parent ? leafGridColumnsOf(parent.data) : GRID_COLUMNS;
        const members =
          parent?.children?.filter((d) => d.firstCompactNode).length ?? cap;
        const cols = Math.min(members, cap) || cap;
        const extent = fch.flexCompactDim![0];
        return fch.x + extent * (0.5 - 0.5 / cols);
      };
      bindings.compactLinkMidY = (node) => {
        const fch = node.firstCompactNode;
        if (!fch) return node.y;
        if (!(node.row ?? 0)) return fch.y - CHILDREN_MARGIN / 2;
        return node.y - this.getChartState().compactMarginBetween(node) / 2;
      };
      bindings.diagonal = (s, t, m, offsets) => {
        if (assistantLink) {
          assistantLink = false;
          teamBusY = null;
          gridTrunkAtParent = false;
          return assistantLinkPath(s, t);
        }
        if (gridChildLink) {
          gridChildLink = false;
          const child = m ?? s;
          if (gridRow > 0) return `M ${child.x} ${child.y}`;
          if (gridTrunkAtParent) {
            gridTrunkAtParent = false;
            return gridChildLinkPath({ x: t.x, y: s.y }, t, child);
          }
          return gridChildLinkPath(s, t, child);
        }
        if (teamBusY != null) {
          const busY = teamBusY;
          teamBusY = null;
          return gridChildLinkPath({ x: t.x, y: busY }, t, s);
        }
        return stockDiagonal(s, t, m, offsets);
      };
    }
  }

  override calculateCompactFlexDimensions(root: ChartNode<D>): void {
    const attrs = this.getChartState();
    root.eachBefore((node) => {
      node.firstCompact = null;
      node.compactEven = null;
      node.flexCompactDim = null;
      node.firstCompactNode = null;
    });
    root.eachBefore((node) => {
      if (!node.children || node.children.length <= 1) return;
      // Only true leaf SEATS grid-wrap (no team children, including
      // collapsed `_children`). Headers and collapsed managers stay in one
      // flextree row.
      const compactChildren = node.children.filter((d) => isCompactLeaf(d));
      if (compactChildren.length < 2) return;

      const cap = leafGridColumnsOf(node.data);
      const gridColumns = Math.min(compactChildren.length, cap);

      compactChildren.forEach((child, i) => {
        if (!i) child.firstCompact = true;
        child.compactEven = i % 2 === 0;
        child.row = Math.floor(i / gridColumns);
        child.col = i % gridColumns;
      });

      const bindings = attrs.layoutBindings[attrs.layout]!;
      const maxColumn =
        max(compactChildren, (d) => bindings.compactDimension.sizeColumn(d)) ?? 0;
      // A grid with fewer seats than the cap gets a box of exactly that
      // many columns — a full-width box would reserve a phantom column as dead
      // space inside the section (2026-08-19 "space on the wrong side" report).
      const columnSize = maxColumn * gridColumns;
      const rowGroups = this.groupBy(
        compactChildren,
        (d) => d.row ?? 0,
        (group) =>
          (max(group, (d) => bindings.compactDimension.sizeRow(d)) ?? 0) +
          attrs.compactMarginBetween(group[0]!),
      );
      const rowSize = sum(rowGroups.map(([, size]) => size));

      compactChildren.forEach((child) => {
        child.firstCompactNode = compactChildren[0]!;
        child.flexCompactDim = child.firstCompact
          ? [
              columnSize + attrs.compactMarginPair(child),
              rowSize - attrs.compactMarginBetween(child),
            ]
          : [0, 0];
      });
      // The grid parent must carry the grid width itself: flextree separates
      // sibling subtrees level-by-level and stops at the shallower contour,
      // so an extent that exists only on the first grid child (one level
      // down) is invisible to the immediate neighbours and their cards
      // overlap the grid. Height stays the parent's own — the first child
      // still carries the grid's row height for the level below.
      node.flexCompactDim = [
        columnSize + attrs.compactMarginPair(node),
        bindings.compactDimension.sizeRow(node) + attrs.childrenMargin(node),
      ];
    });

    // Rigid sections: every parent reserves its
    // visible subtree's full width as its level-0 slot. flextree separates
    // sibling subtrees level-by-level and stops at the shallower contour, so
    // without the reservation a collapsed sibling only clears the parent's
    // card-width slot and its card tucks into the section's x-range. Because
    // every parent is reserved, each subtree is a rigid rectangle: children
    // pack contiguously and fill the slot exactly, the bottom-up sum is exact
    // (no interleaving to estimate around), and section gaps are symmetric.
    // Cards render at standard width, centred over their children.
    root.eachAfter((node) => {
      const ownSlot = attrs.nodeWidth(node) + attrs.siblingsMargin(node);
      let extent = ownSlot;
      if (node.children?.length) {
        let span = 0;
        for (const child of node.children) {
          if (child.data.isAssistant) continue;
          if (child.firstCompactNode && !child.firstCompact) continue; // inside the grid box
          span += child.firstCompact
            ? child.flexCompactDim![0]
            : (child.subtreeExtent ?? ownSlot);
        }
        extent = Math.max(ownSlot, span);
      }
      node.subtreeExtent = extent;
      // Grid members are leaves and never reach here; the guard is insurance
      // against grid membership ever widening — their flexCompactDim belongs
      // to the grid box, not the section rule.
      if (node.children?.length && !node.firstCompactNode) {
        node.flexCompactDim = [
          extent,
          attrs.nodeHeight(node) + attrs.childrenMargin(node),
        ];
      }
    });
  }

  override calculateCompactFlexPositions(root: ChartNode<D>): void {
    const attrs = this.getChartState();
    root.eachBefore((node) => {
      if (!node.children) return;
      // Grid membership is marked by firstCompactNode, NOT flexCompactDim:
      // grid parents also carry a flexCompactDim (the slot-reservation width),
      // and filtering on it would reposition the parent into a phantom grid.
      const compactChildren = node.children.filter((d) => d.firstCompactNode);
      const fch = compactChildren[0];
      if (!fch) return;
      const extent = fch.flexCompactDim![0];
      const parentRow = node.data as GridRowData;
      const cap = leafGridColumnsOf(parentRow);
      const gridColumns = Math.min(compactChildren.length, cap);

      // flextree positioned fch at the centre of the grid extent. Capture the
      // grid's left edge in a local BEFORE the loop: the loop also assigns
      // compactChildren[0].x, and compactChildren[0] IS fch — reading fch.x
      // inside the loop would drift the base by one half-column and push the
      // last column past the allocated box (overlap with the next subtree).
      const gridLeft = fch.x - extent / 2;
      compactChildren.forEach((child) => {
        child.x = gridLeft + (extent * ((child.col ?? 0) + 0.5)) / gridColumns;
      });

      // Nudge the group so the grid centre sits under the parent (library rule:
      // only small corrections, larger ones mean flextree already centred well).
      const offsetX = node.x - (gridLeft + extent / 2);
      if (Math.abs(offsetX) < 10) {
        compactChildren.forEach((d) => (d.x += offsetX));
      }

      const bindings = attrs.layoutBindings[attrs.layout]!;
      const rowGroups = this.groupBy(
        compactChildren,
        (d) => d.row ?? 0,
        (group) => max(group, (d) => bindings.compactDimension.sizeRow(d)) ?? 0,
      );
      const cumSum = cumsum(
        rowGroups.map(([, size]) => size + attrs.compactMarginBetween(node)),
      );
      compactChildren.forEach((child) => {
        child.y = child.row ? fch.y + cumSum[child.row - 1]! : fch.y;
      });
    });

    root.eachBefore((node) => {
      const assistants = node.children?.filter((child) => child.data.isAssistant) ?? [];
      if (assistants.length === 0) return;
      const team = (node.children ?? []).filter(
        (child) => !child.data.isAssistant && !child.data._pagingButton,
      );
      const parentBottom = node.y + node.height / 2;
      const childTop =
        team.length > 0
          ? Math.min(...team.map((c) => c.y - c.height / 2))
          : parentBottom + 80;
      for (const assistant of assistants) {
        assistant.x = node.x + node.width * 0.7;
        assistant.y = (parentBottom + childTop) / 2;
      }
    });
  }

  override onButtonClick(event: Event, d: ChartNode<D>): void {
    event.stopPropagation();
    if (d.data._pagingButton) return;
    const attrs = this.getChartState();
    const [x] = pointer(event, event.currentTarget as Element);
    const mode = expandModeFromEvent(
      event,
      x,
      attrs.nodeButtonX(d),
      attrs.nodeButtonWidth(d),
    );
    this.onExpandChip?.(d.data.id, mode);
  }
}

export type { ChartNode, ChartState };
