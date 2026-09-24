"use client";

/**
 * d3-org-chart client component.
 *
 * - Instantiated once; data changes go through the reconciler, never a recreate.
 * - Unmount calls `chart.clear()` so d3-org-chart's window resize listener and
 *   canvas 2d context are not retained across navigations.
 * - Peer seats render as stacked full cards; click opens the clicked member.
 * - ResizeObserver keeps svgWidth/svgHeight in sync and re-applies the current
 *   zoom transform so the chart does not jump.
 * - Search focus (`focusId`): expand the target and its ancestors, then pan that
 *   card to the viewport centre with a synchronous zoom.transform.
 * - Undo/redo motion (`motionId`): keep expand state, let the 400ms layout tween
 *   play, pulse the card, and ease-pan only if the destination is off-screen.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { zoomIdentity, zoomTransform } from "d3";

import {
  cardHtml,
  escapeHtml,
  memberAuthIdFromTarget,
  type CardContext,
  type MergeTint,
} from "./card";
import {
  assistantChild,
  descendantEmployeeCount,
  directChildNodeCount,
  indexFromRows,
  type ChartIndex,
  type ChartRow,
} from "./chart-row";
import { cardCenterTransform, nodeInViewport } from "./center";
import {
  applyExpandChip,
  applyExpandChipMirror,
  type ExpandChipSnapshot,
  applyInitialCollapse,
  expandOneNode,
  hasVisibleChildren,
  pagingConfig,
  subtreeFullyExpanded,
} from "./collapse";
import { notifyChartLimit } from "./chart-limit";
import {
  CHIP_HEIGHT,
  CHIP_WIDTH,
  expandChipHtml,
  type ExpandMode,
} from "./expand-chip";
import { applyFocusExpansion, clearCentered } from "./focus";
import { GridOrgChart } from "./grid-org-chart";
import { carryRenderState, classifyUpdate, patchLiveContent } from "./reconciler";
import { attachDragController } from "./drag/drag-controller";
import { CardContextMenu, type ContextMenuState } from "./drag/context-menu";
import type { Drop } from "./drag/apply";

export type ChartCamera = {
  zoomBy: (factor: number) => void;
  fitVisible: () => void;
};

export interface OrgChartViewProps {
  treeId: string;
  rows: ChartRow[];
  focusId?: string | null;
  /** Bumped on each search select so focusing the same node again re-runs. */
  focusGen?: number;
  /** Chart search: keep already-open teams. Isolate callers omit this. */
  preserveExpanded?: boolean;
  /** Undo/redo: pulse + pan-if-offscreen. Does not collapse the tree. */
  motionId?: string | null;
  motionGen?: number;
  onCardClick?: (authId: string, nodeId: string) => void;
  /** Sandbox mode: wires the drag controller. Published view never sets this. */
  editable?: boolean;
  onDrop?: (drop: Drop) => void;
  onAddChild?: (parentId: string, kind: "header" | "seat") => void;
  onAddAssistant?: (parentId: string) => void;
  onPlaceAssistant?: (nodeId: string) => void;
  onPlaceInTeam?: (nodeId: string) => void;
  onRename?: (nodeId: string) => void;
  onDelete?: (nodeId: string) => void;
  onSetLeafGridColumns?: (nodeId: string, columns: number) => void;
  tints?: Partial<Record<string, MergeTint>>;
  savingIds?: string[];
  onUserTransform?: (t: { x: number; y: number; k: number }) => void;
  externalTransform?: { x: number; y: number; k: number } | null;
  expandSync?: {
    nodeId: string;
    mode: ExpandMode;
    levelOpen: boolean;
    fullyExpanded: boolean;
    gen: number;
    sourceTreeId: string;
  } | null;
  onUserExpand?: (
    nodeId: string,
    mode: ExpandMode,
    snapshot: ExpandChipSnapshot,
  ) => void;
  cameraRef?: { current: ChartCamera | null };
}

const SEAT_WIDTH = 220;
const SEAT_HEIGHT = 72;
const HEADER_HEIGHT = 44;
const JOINING_EXTRA = 16;
/** d3-org-chart default. Restored after a duration-0 centred render. */
const CHART_DURATION_MS = 400;
/** Padding + gap inside the peer wrapper (p-1 + gap-1). */
const PEER_WRAP_PAD = 8;
const PEER_STACK_GAP = 4;
const TITLE_EXTRA = 16;
const seatHeight = (row: ChartRow, editable: boolean) => {
  const titleExtra = editable ? TITLE_EXTRA : 0;
  if (row.members.length === 0) {
    return SEAT_HEIGHT + titleExtra;
  }
  let height = 0;
  for (const member of row.members) {
    height +=
      SEAT_HEIGHT + (member.status === "joining" ? JOINING_EXTRA : 0) + titleExtra;
  }
  if (row.members.length > 1) {
    height += PEER_WRAP_PAD + (row.members.length - 1) * PEER_STACK_GAP;
  }
  return height;
};

function emitUserTransform(
  chart: GridOrgChart<ChartRow>,
  emit: ((t: { x: number; y: number; k: number }) => void) | undefined,
  skip: boolean,
): void {
  if (skip || !emit) return;
  syncLastTransform(chart);
  const t = chart.getChartState().lastTransform;
  if (!t) return;
  emit({ x: Number(t.x), y: Number(t.y), k: Number(t.k) });
}

function syncLastTransform(chart: GridOrgChart<ChartRow>): void {
  const state = chart.getChartState();
  const svgNode = state.svg?.node();
  if (!svgNode || !state.zoomBehavior) return;
  state.lastTransform = zoomTransform(svgNode);
}

function syncSvgSize(chart: GridOrgChart<ChartRow>, container: HTMLElement): void {
  const width = Math.round(container.clientWidth);
  const height = Math.round(container.clientHeight);
  if (width > 0 && height > 0) {
    chart.svgWidth(width).svgHeight(height);
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function tweenDuration(): number {
  return prefersReducedMotion() ? 0 : CHART_DURATION_MS;
}

function interruptLayout(chart: GridOrgChart<ChartRow>): void {
  chart.getChartState().svg?.interrupt();
}

function pulseNode(container: HTMLElement, nodeId: string): () => void {
  const frame = container.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
  if (!frame) return () => {};
  frame.classList.add("node-pulse");
  const ms = prefersReducedMotion() ? 400 : 2400;
  const timer = window.setTimeout(() => frame.classList.remove("node-pulse"), ms);
  return () => {
    window.clearTimeout(timer);
    frame.classList.remove("node-pulse");
  };
}

function renderLayout(
  chart: GridOrgChart<ChartRow>,
  rows: ChartRow[],
  duration: number,
): void {
  interruptLayout(chart);
  chart.duration(duration);
  chart.data(rows).render();
  if (duration === 0) chart.duration(CHART_DURATION_MS);
}

/** Layout with duration 0, then pan the target to the viewport centre with a
 *  synchronous zoom.transform. The library's `_centered` fit is a transition
 *  even at duration 0 — interrupting it (required so pan works) would cancel
 *  that camera, so we apply the equivalent transform ourselves. */
function renderCentered(
  chart: GridOrgChart<ChartRow>,
  rows: ChartRow[],
  nodeId: string,
  container: HTMLElement,
): void {
  syncSvgSize(chart, container);
  interruptLayout(chart);
  chart.duration(0);
  chart.render();
  clearCentered(rows);
  applyCardCenter(chart, nodeId);
  chart.duration(CHART_DURATION_MS);
}

function applyCardCenter(chart: GridOrgChart<ChartRow>, nodeId: string): void {
  const state = chart.getChartState();
  const node = state.allNodes?.find((d) => d.data.id === nodeId);
  if (!node || !state.zoomBehavior) return;
  const t = cardCenterTransform({
    nodeX: node.x,
    nodeY: node.y,
    nodeHeight: node.height,
    svgWidth: state.svgWidth,
    svgHeight: state.svgHeight,
    scale: Number(state.lastTransform?.k ?? 1) || 1,
  });
  state.svg.interrupt();
  state.zoomBehavior.transform(state.svg, t);
  state.lastTransform = t;
}

/** Named `camera` tween so it does not interrupt the library's layout transition. */
function easeCardCenter(
  chart: GridOrgChart<ChartRow>,
  nodeId: string,
  duration: number,
): void {
  const state = chart.getChartState();
  const node = state.allNodes?.find((d) => d.data.id === nodeId);
  if (!node || !state.zoomBehavior) return;
  const t = cardCenterTransform({
    nodeX: node.x,
    nodeY: node.y,
    nodeHeight: node.height,
    svgWidth: state.svgWidth,
    svgHeight: state.svgHeight,
    scale: Number(state.lastTransform?.k ?? 1) || 1,
  });
  state.svg.interrupt("camera");
  if (duration === 0) {
    state.zoomBehavior.transform(state.svg, t);
    state.lastTransform = t;
    return;
  }
  state.svg
    .transition("camera")
    .duration(duration)
    .call(state.zoomBehavior.transform, t)
    .on("end interrupt", () => {
      syncLastTransform(chart);
    });
}

export default function OrgChartView({
  treeId,
  rows,
  focusId,
  focusGen,
  preserveExpanded = false,
  motionId,
  motionGen,
  onCardClick,
  editable = false,
  onDrop,
  onAddChild,
  onAddAssistant,
  onPlaceAssistant,
  onPlaceInTeam,
  onRename,
  onDelete,
  onSetLeafGridColumns,
  tints,
  savingIds = [],
  onUserTransform,
  externalTransform,
  expandSync,
  onUserExpand,
  cameraRef,
}: OrgChartViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<GridOrgChart<ChartRow> | null>(null);
  const stateRef = useRef({ treeId, rows });
  stateRef.current = { treeId, rows };
  const reconciledRef = useRef({ treeId, rows });
  const index = useMemo(() => indexFromRows(rows), [rows]);
  const indexRef = useRef<ChartIndex>(index);
  indexRef.current = index;
  const onCardClickRef = useRef(onCardClick);
  onCardClickRef.current = onCardClick;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const onAddChildRef = useRef(onAddChild);
  onAddChildRef.current = onAddChild;
  const onAddAssistantRef = useRef(onAddAssistant);
  onAddAssistantRef.current = onAddAssistant;
  const onPlaceAssistantRef = useRef(onPlaceAssistant);
  onPlaceAssistantRef.current = onPlaceAssistant;
  const onPlaceInTeamRef = useRef(onPlaceInTeam);
  onPlaceInTeamRef.current = onPlaceInTeam;
  const onRenameRef = useRef(onRename);
  onRenameRef.current = onRename;
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;
  const onSetLeafGridColumnsRef = useRef(onSetLeafGridColumns);
  onSetLeafGridColumnsRef.current = onSetLeafGridColumns;
  const onUserTransformRef = useRef(onUserTransform);
  onUserTransformRef.current = onUserTransform;
  const onUserExpandRef = useRef(onUserExpand);
  onUserExpandRef.current = onUserExpand;
  const tintsRef = useRef(tints);
  tintsRef.current = tints;
  const savingIdsRef = useRef(new Set(savingIds));
  savingIdsRef.current = new Set(savingIds);
  const applyingExternal = useRef(false);
  const applyingExternalExpand = useRef(false);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  // Counts come from the ROW: the library annotates data objects
  // (row._directSubordinates/_totalSubordinates) in setLayouts, not the node.
  const ctxFor = (row: ChartRow): CardContext => ({
    dept: indexRef.current.deptById.get(row.id) ?? null,
    colors: indexRef.current.deptColorById,
    isRoot: row.id === indexRef.current.rootId,
    editable,
    mergeTint: tintsRef.current?.[row.id],
    saving: savingIdsRef.current.has(row.id),
  });

  // Mount: create the chart once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    notifyChartLimit(
      applyInitialCollapse(stateRef.current.rows, indexRef.current).limited,
    );

    let lastMemberAuthId: string | null = null;
    const onCardPointerDown = (event: PointerEvent) => {
      lastMemberAuthId = memberAuthIdFromTarget(event.target);
    };
    container.addEventListener("pointerdown", onCardPointerDown);

    const chart = new GridOrgChart<ChartRow>()
      .container(container)
      .data(stateRef.current.rows)
      .nodeId((d) => d.id)
      .parentNodeId((d) => d.parentId)
      // Top-down: headers form a horizontal row under the root; leaf seat cards
      // Wrap into a 3-column grid using compact packing.
      .layout("top")
      .nodeWidth(() => SEAT_WIDTH)
      .nodeHeight((d) =>
        d.data.kind === "header" ? HEADER_HEIGHT : seatHeight(d.data, editable),
      )
      .nodeButtonWidth(() => CHIP_WIDTH)
      .nodeButtonHeight(() => CHIP_HEIGHT)
      .nodeButtonX(() => -CHIP_WIDTH / 2)
      .nodeButtonY(() => -CHIP_HEIGHT / 2)
      .nodeContent(
        (node) =>
          `<div data-node-id="${escapeHtml(node.data.id)}" class="h-full w-full${editable ? " cursor-move" : ""}">${cardHtml(node.data, ctxFor(node.data))}</div>`,
      )
      .buttonContent(({ node }) =>
        expandChipHtml({
          nextLevelOpen: hasVisibleChildren(
            stateRef.current.rows,
            indexRef.current,
            node.data.id,
          ),
          fullyExpanded: subtreeFullyExpanded(
            stateRef.current.rows,
            indexRef.current,
            node.data.id,
          ),
          total: descendantEmployeeCount(indexRef.current, node.data.id),
          direct: directChildNodeCount(indexRef.current, node.data.id),
        }),
      )
      .onNodeClick((node) => {
        const authId = lastMemberAuthId ?? node.data.members[0]?.authId;
        if (authId) onCardClickRef.current?.(authId, node.data.id);
      })
      .onZoom((event) => {
        if (applyingExternal.current || !event.sourceEvent) return;
        const t = event.transform;
        onUserTransformRef.current?.({
          x: Number(t.x),
          y: Number(t.y),
          k: Number(t.k),
        });
      })
      .minPagingVisibleNodes(pagingConfig.minPagingVisibleNodes)
      .pagingStep(pagingConfig.pagingStep)
      .compact(true)
      .duration(CHART_DURATION_MS);
    chart.onExpandChip = (nodeId, mode) => {
      const rows = stateRef.current.rows;
      const index = indexRef.current;
      const result = applyExpandChip(rows, index, nodeId, mode);
      notifyChartLimit(result.limited);
      renderLayout(chart, rows, tweenDuration());
      onUserExpandRef.current?.(nodeId, mode, {
        levelOpen: hasVisibleChildren(rows, index, nodeId),
        fullyExpanded: subtreeFullyExpanded(rows, index, nodeId),
      });
    };
    // Initial view: centre on the root at readable zoom. fit() here would run
    // before the container has its final size and leave the tree tiny in a
    // corner; the reconciler still fit()s on a full tree switch. The flag goes
    // on the data directly — setCentered() needs internals that only exist
    // after the first render().
    const rootRow = stateRef.current.rows.find((r) => r.id === indexRef.current.rootId);
    if (rootRow) rootRow._centered = true;
    renderCentered(chart, stateRef.current.rows, indexRef.current.rootId, container);
    chartRef.current = chart;
    if (cameraRef) {
      cameraRef.current = {
        zoomBy: (factor) => {
          const live = chartRef.current;
          if (!live) return;
          const state = live.getChartState();
          if (!state.zoomBehavior || !state.svg) return;
          state.zoomBehavior.scaleBy(state.svg, factor);
          emitUserTransform(live, onUserTransformRef.current, applyingExternal.current);
        },
        fitVisible: () => {
          const live = chartRef.current;
          if (!live) return;
          live.fit({
            animate: false,
            onCompleted: () =>
              emitUserTransform(
                live,
                onUserTransformRef.current,
                applyingExternal.current,
              ),
          });
          emitUserTransform(live, onUserTransformRef.current, applyingExternal.current);
        },
      };
    }

    // Sandbox drag grammar. Card-originated mouse pans are disabled
    // so the drag gesture owns the pointer; canvas panning still works.
    let detachDrag: (() => void) | null = null;
    if (editable) {
      const state = chart.getChartState();
      state.zoomBehavior?.filter(
        (event: { type?: string; target?: EventTarget | null }) => {
          if (event.type !== "mousedown") return true;
          const el = event.target as HTMLElement | null;
          return !el?.closest?.("[data-node-id]");
        },
      );
      detachDrag = attachDragController({
        container,
        getRows: () => stateRef.current.rows,
        getIndex: () => indexRef.current,
        onExpandNode: (nodeId) => {
          const row = stateRef.current.rows.find(
            (candidate) => candidate.id === nodeId,
          );
          if (!row) return;
          const result = expandOneNode(stateRef.current.rows, indexRef.current, nodeId);
          notifyChartLimit(result.limited);
          if (result.added === 0 && row._expanded !== true) return;
          renderLayout(chart, stateRef.current.rows, 0);
        },
        onDrop: (drop) => onDropRef.current?.(drop),
        // Edge auto-pan: translate the zoom transform by screen px.
        // Goes through zoomBehavior.transform so the library's zoom event and
        // onUserTransform stay consistent; never triggers a render().
        panBy: (dxPx, dyPx) => {
          const state = chart.getChartState();
          const t = state.lastTransform;
          if (!state.zoomBehavior || !state.svg || t == null) return;
          const k = Number(t.k) || 1;
          const next = zoomIdentity
            .translate(Number(t.x) + dxPx, Number(t.y) + dyPx)
            .scale(k);
          state.svg.interrupt("camera");
          state.zoomBehavior.transform(state.svg, next);
          state.lastTransform = next;
        },
      });

      // Card context menu: right-click on a card
      // only — empty canvas keeps the browser menu.
      const onContextMenu = (event: MouseEvent) => {
        const card = (event.target as HTMLElement).closest("[data-node-id]");
        if (!card || !container.contains(card)) return;
        event.preventDefault();
        const nodeId = card.getAttribute("data-node-id")!;
        const row = stateRef.current.rows.find((r) => r.id === nodeId);
        if (!row) return;
        const label =
          row.kind === "header"
            ? (row.name ?? "team")
            : (row.members[0]?.displayName ?? row.jobTitle ?? "seat");
        const parent = row.parentId
          ? stateRef.current.rows.find((candidate) => candidate.id === row.parentId)
          : undefined;
        const parentHasAssistant = row.parentId
          ? Boolean(assistantChild(indexRef.current, row.parentId))
          : false;
        const ownHasAssistant = Boolean(assistantChild(indexRef.current, row.id));
        const canAddAssistant =
          row.kind === "seat" && !row.isAssistant && !ownHasAssistant;
        const canPlaceAsAssistant =
          row.kind === "seat" &&
          !row.isAssistant &&
          row.parentId !== "" &&
          parent?.kind === "seat" &&
          !parentHasAssistant &&
          row.members.length === 1 &&
          (indexRef.current.childrenById.get(row.id) ?? []).length === 0;
        setMenu({
          x: event.clientX,
          y: event.clientY,
          nodeId,
          label,
          kind: row.kind,
          isRoot: row.parentId === "",
          isAssistant: Boolean(row.isAssistant),
          leafGridColumns: row.leafGridColumns ?? 3,
          canAddAssistant,
          canPlaceAsAssistant,
        });
      };
      container.addEventListener("contextmenu", onContextMenu);
      const prevDetach = detachDrag;
      detachDrag = () => {
        prevDetach?.();
        container.removeEventListener("contextmenu", onContextMenu);
      };
    }

    // Resize: sync dimensions, re-apply the live zoom transform.
    let lastWidth = 0;
    let lastHeight = 0;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      const chart = chartRef.current;
      if (!rect || !chart) return;
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      const state = chart.getChartState();
      chart.svgWidth(width).svgHeight(height);
      const t = state.lastTransform;
      if (!state.zoomBehavior || t == null) return;
      state.zoomBehavior.transform(
        state.svg,
        zoomIdentity.translate(Number(t.x), Number(t.y)).scale(Number(t.k)),
      );
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      container.removeEventListener("pointerdown", onCardPointerDown);
      detachDrag?.();
      chart.clear();
      chartRef.current = null;
      if (cameraRef) cameraRef.current = null;
      container.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once chart; editable is fixed per route
  }, []);

  // Data changes: reconcile, never recreate.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const prev = reconciledRef.current;
    const tier = classifyUpdate(prev.rows, rows, {
      treeChanged: prev.treeId !== treeId,
    });
    if (tier === "same") {
      reconciledRef.current = { treeId, rows };
      return;
    }

    if (tier === "content") {
      const nextById = new Map(rows.map((row) => [row.id, row]));
      const bound = chart.getChartState().allNodes;
      if (!bound) {
        renderLayout(chart, rows, 0);
      } else {
        for (const node of bound) {
          const next = nextById.get(node.data.id);
          if (next) patchLiveContent(node.data, next);
        }
        chart.data(rows).restyleForeignObjectElements();
      }
    } else {
      carryRenderState(prev.rows, rows);
      renderLayout(chart, rows, tier === "structural-refit" ? 0 : tweenDuration());
      if (tier === "structural-refit") chart.fit();
      syncLastTransform(chart);
    }
    reconciledRef.current = { treeId, rows };
  }, [treeId, rows]);

  const savingKey = savingIds.slice().sort().join(",");
  useEffect(() => {
    chartRef.current?.restyleForeignObjectElements();
  }, [tints, savingKey]);

  // Search focus: expand target + ancestors, centre synchronously, pulse.
  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container || !focusId) return;
    const current = stateRef.current.rows;
    const focused = applyFocusExpansion(current, focusId, { preserveExpanded });
    if (!focused) return;
    notifyChartLimit(focused.limited);
    const target = current.find((row) => row.id === focusId);
    if (target) target._centered = true;
    chart.data(current);
    renderCentered(chart, current, focusId, container);
    return pulseNode(container, focusId);
  }, [focusId, focusGen, preserveExpanded]);

  // Undo/redo motion: pulse; ease-pan only if the destination is off-screen.
  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container || !motionId) return;
    const state = chart.getChartState();
    const node = state.allNodes?.find((d) => d.data.id === motionId);
    if (!node) return pulseNode(container, motionId);
    const visible = nodeInViewport({
      nodeX: node.x,
      nodeY: node.y,
      nodeWidth: node.width,
      nodeHeight: node.height,
      transform: state.lastTransform,
      svgWidth: state.svgWidth,
      svgHeight: state.svgHeight,
    });
    if (!visible) easeCardCenter(chart, motionId, tweenDuration());
    return pulseNode(container, motionId);
  }, [motionId, motionGen]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !externalTransform) return;
    const state = chart.getChartState();
    if (!state.zoomBehavior) return;
    applyingExternal.current = true;
    state.zoomBehavior.transform(
      state.svg,
      zoomIdentity
        .translate(externalTransform.x, externalTransform.y)
        .scale(externalTransform.k),
    );
    state.lastTransform = externalTransform;
    applyingExternal.current = false;
  }, [externalTransform]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !expandSync || expandSync.sourceTreeId === treeId) return;
    applyingExternalExpand.current = true;
    const rows = stateRef.current.rows;
    const mirrored = applyExpandChipMirror(
      rows,
      indexRef.current,
      expandSync.nodeId,
      expandSync.mode,
      {
        levelOpen: expandSync.levelOpen,
        fullyExpanded: expandSync.fullyExpanded,
      },
    );
    notifyChartLimit(mirrored.limited);
    renderLayout(chart, rows, tweenDuration());
    applyingExternalExpand.current = false;
  }, [expandSync, treeId]);

  return (
    <>
      <div
        ref={containerRef}
        className="h-full w-full select-none"
        data-tree-id={treeId}
      />
      {menu && (
        <CardContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onAdd={(nodeId, kind) => {
            setMenu(null);
            onAddChildRef.current?.(nodeId, kind);
          }}
          onAddAssistant={(nodeId) => {
            setMenu(null);
            onAddAssistantRef.current?.(nodeId);
          }}
          onPlaceAssistant={(nodeId) => {
            setMenu(null);
            onPlaceAssistantRef.current?.(nodeId);
          }}
          onPlaceInTeam={(nodeId) => {
            setMenu(null);
            onPlaceInTeamRef.current?.(nodeId);
          }}
          onRename={(nodeId) => {
            setMenu(null);
            onRenameRef.current?.(nodeId);
          }}
          onDelete={(nodeId) => {
            setMenu(null);
            onDeleteRef.current?.(nodeId);
          }}
          onSetLeafGridColumns={(nodeId, columns) => {
            setMenu(null);
            onSetLeafGridColumnsRef.current?.(nodeId, columns);
          }}
        />
      )}
    </>
  );
}
