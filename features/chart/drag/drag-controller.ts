/**
 * Pointer-based drag controller. Attached by OrgChartView only in
 * editable (sandbox) mode; the published chart never loads this.
 *
 * Mechanics:
 * - pointerdown on a card arms a drag and captures the pointer; 4px of
 *   movement starts it (clicks survive). Native HTML image drag is suppressed
 *   (avatars). pointercancel / lostpointercapture tear the ghost down without
 *   committing. A drag that has started swallows the following click so it
 *   does not open the employee dialog. Card-originated panning is disabled by
 *   the caller via the zoom filter, so no gesture conflict.
 * - Hit-testing uses card rects cached at drag start (and re-cached after a
 *   hover-expand relayout). Card interior wins; 40px left/right strips are
 *   sibling insert.
 * - Each move classifies the zone (zone.ts), validates it (validate.ts), and
 *   paints the indicator layers: card outline class, green caret, cursor chip.
 * - Hovering a collapsed node for 600ms expands it and re-caches rects.
 * - Drop calls back with the canonical Drop; reject shakes the ghost.
 */

import type { ChartIndex, ChartRow } from "../chart-row";
import { toDrop, toMemberDrop, type Drop } from "./apply";
import { chipText } from "./chip";
import { edgePanVelocity } from "./edge-pan";
import { hitTest, type CardRect } from "./hit-test";
import { validateDrop, validateMemberDrop } from "./validate";
import { classifyZone, type Zone } from "./zone";

export interface DragControllerOptions {
  container: HTMLElement;
  getRows: () => ChartRow[];
  getIndex: () => ChartIndex;
  /** Expand a collapsed node mid-drag (hover-to-expand). */
  onExpandNode: (nodeId: string) => void;
  onDrop: (drop: Drop) => void;
  /**
   * Edge auto-pan: translate the camera by screen-space px while the
   * pointer is held near a container edge. Optional — published view has no
   * drag controller at all; omitting it disables auto-pan.
   */
  panBy?: (dxPx: number, dyPx: number) => void;
}

const DRAG_THRESHOLD_PX = 4;
const HOVER_EXPAND_MS = 600;

const ZONE_CLASSES = ["dz-child", "dz-peer", "dz-reject"] as const;

export function attachDragController(opts: DragControllerOptions): () => void {
  const { container } = opts;

  let captured: { el: Element; pointerId: number } | null = null;
  let didDrag = false;
  let armed: {
    nodeId: string;
    memberAuthId: string | null;
    startX: number;
    startY: number;
  } | null = null;
  // Edge auto-pan state: last pointer position (drives the rAF loop even when
  // no pointermove fires), the container rect measured at drag start, and the
  // running frame handle.
  let lastPointer: { x: number; y: number } | null = null;
  let containerRect: DOMRect | null = null;
  let panFrame: number | null = null;
  let lastPanTs: number | null = null;
  let active: {
    nodeId: string;
    /** Set when the drag carries one member (grip handle), not the card. */
    memberAuthId: string | null;
    ghost: HTMLElement;
    chip: HTMLElement;
    caret: HTMLElement;
    rects: CardRect[];
    targetEl: Element | null;
    targetId: string | null;
    zone: Zone | null;
    valid: boolean;
    reason: string | null;
    hoverTimer: number | null;
    hoverId: string | null;
  } | null = null;

  const cacheRects = (): CardRect[] =>
    Array.from(container.querySelectorAll("[data-node-id]")).flatMap((el) => {
      const id = el.getAttribute("data-node-id")!;
      const row = opts.getRows().find((candidate) => candidate.id === id);
      if (row?.isAssistant) return [];
      const rect = el.getBoundingClientRect();
      return [
        {
          id,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
      ];
    });

  const clearIndicators = () => {
    if (!active) return;
    if (active.targetEl) active.targetEl.classList.remove(...ZONE_CLASSES);
    active.targetEl = null;
    active.caret.style.display = "none";
  };

  const paintIndicators = () => {
    if (!active) return;
    clearIndicators();
    const rows = opts.getRows();
    const dragged = rows.find((row) => row.id === active!.nodeId);
    const target = rows.find((row) => row.id === active!.targetId);
    const zone = active.zone ?? { zone: "reject" as const, reason: "Drop on a card" };

    active.chip.textContent = chipText(
      zone,
      active.valid,
      active.reason,
      dragged,
      target,
      active.memberAuthId,
    );
    active.chip.dataset.state = active.valid ? "ok" : "reject";

    if (!active.targetId || !zone) return;
    const el = container.querySelector(`[data-node-id="${active.targetId}"]`);
    if (!el) return;
    active.targetEl = el;

    if (!active.valid) {
      el.classList.add("dz-reject");
      return;
    }
    if (zone.zone === "child") el.classList.add("dz-child");
    if (zone.zone === "peer") el.classList.add("dz-peer");
    if (zone.zone === "sibling-before" || zone.zone === "sibling-after") {
      const box = el.getBoundingClientRect();
      active.caret.style.display = "block";
      active.caret.style.top = `${box.top}px`;
      active.caret.style.height = `${box.height}px`;
      active.caret.style.left =
        zone.zone === "sibling-before" ? `${box.left}px` : `${box.right}px`;
    }
  };

  const updateTarget = (x: number, y: number) => {
    if (!active) return;
    const { targetId, insideCard, relY, side } = hitTest(
      x,
      y,
      active.rects,
      active.nodeId,
    );

    const rows = opts.getRows();
    const target = rows.find((row) => row.id === targetId) ?? null;
    const zone = classifyZone(target ? { kind: target.kind } : null, {
      insideCard,
      relY,
      side,
    });
    const verdict = active.memberAuthId
      ? validateMemberDrop(
          rows,
          opts.getIndex(),
          active.nodeId,
          active.memberAuthId,
          targetId,
          zone,
        )
      : validateDrop(rows, opts.getIndex(), active.nodeId, targetId, zone);

    active.targetId = targetId;
    active.zone = zone;
    active.valid = verdict.ok;
    active.reason = verdict.ok ? null : verdict.reason;

    // Hover-to-expand is card-only (child/peer). A gap drop reorders among
    // visible siblings and must not expand the hovered card.
    const hoverCandidate =
      targetId && verdict.ok && (zone.zone === "child" || zone.zone === "peer")
        ? targetId
        : null;
    if (hoverCandidate !== active.hoverId) {
      active.hoverId = hoverCandidate;
      if (active.hoverTimer !== null) window.clearTimeout(active.hoverTimer);
      active.hoverTimer = null;
      if (hoverCandidate) {
        const row = rows.find((r) => r.id === hoverCandidate);
        const hasChildren =
          (opts.getIndex().childrenById.get(hoverCandidate) ?? []).length > 0;
        if (row && row._expanded === false && hasChildren) {
          active.hoverTimer = window.setTimeout(() => {
            opts.onExpandNode(hoverCandidate);
            if (active) active.rects = cacheRects();
          }, HOVER_EXPAND_MS);
        }
      }
    }

    paintIndicators();
  };

  const startDrag = (x: number, y: number) => {
    if (!armed) return;
    const sourceEl = container.querySelector(`[data-node-id="${armed.nodeId}"]`);
    if (!sourceEl) {
      armed = null;
      return;
    }
    const { memberAuthId } = armed;
    const memberRowEl = memberAuthId
      ? sourceEl.querySelector(`[data-member-id="${CSS.escape(memberAuthId)}"]`)
      : null;

    const ghost = document.createElement("div");
    ghost.className = "dz-ghost";
    if (memberRowEl) {
      // Member drag: the ghost is just the person's row, not the whole card.
      const rowClone = memberRowEl.cloneNode(true) as HTMLElement;
      ghost.classList.add(
        "rounded-lg",
        "border",
        "border-border",
        "bg-card",
        "shadow-sm",
      );
      ghost.appendChild(rowClone);
      ghost.style.width = `${sourceEl.getBoundingClientRect().width}px`;
      memberRowEl.classList.add("dz-source");
    } else {
      ghost.innerHTML = sourceEl.innerHTML;
      ghost.style.width = `${sourceEl.getBoundingClientRect().width}px`;
      sourceEl.classList.add("dz-source");
    }
    document.body.appendChild(ghost);

    const chip = document.createElement("div");
    chip.className = "dz-chip";
    document.body.appendChild(chip);

    const caret = document.createElement("div");
    caret.className = "dz-caret";
    caret.style.display = "none";
    document.body.appendChild(caret);

    active = {
      nodeId: armed.nodeId,
      memberAuthId,
      ghost,
      chip,
      caret,
      rects: cacheRects(),
      targetEl: null,
      targetId: null,
      zone: null,
      valid: false,
      reason: null,
      hoverTimer: null,
      hoverId: null,
    };
    armed = null;
    didDrag = true;
    document.body.style.cursor = "move";
    moveGhost(x, y);
    updateTarget(x, y);
    trackPan(x, y);
  };

  const moveGhost = (x: number, y: number) => {
    if (!active) return;
    active.ghost.style.left = `${x + 12}px`;
    active.ghost.style.top = `${y + 12}px`;
    active.chip.style.left = `${x + 12}px`;
    active.chip.style.top = `${y + 12 + (active.ghost.offsetHeight || 80) + 8}px`;
  };

  const stopPanLoop = () => {
    if (panFrame !== null) cancelAnimationFrame(panFrame);
    panFrame = null;
    lastPanTs = null;
    lastPointer = null;
    containerRect = null;
  };

  /**
   * Auto-pan frame. Runs only while the last pointer
   * position sits inside an edge margin; a still pointer still pans because
   * the loop is rAF-driven, not pointermove-driven. After translating the
   * camera, the cached card rects shift by the same screen-space delta — a
   * pure translation keeps cached rects exact, so hit-testing needs no
   * getBoundingClientRect re-reads per frame. The target then
   * re-classifies so zones, the caret, and hover-expand track the content
   * sliding under the pointer.
   */
  const panStep = (ts: number) => {
    panFrame = null;
    if (!active || !lastPointer || !containerRect || !opts.panBy) return;
    const { dx, dy } = edgePanVelocity(lastPointer.x, lastPointer.y, containerRect);
    if (dx === 0 && dy === 0) {
      lastPanTs = null;
      return;
    }
    // Elapsed since the previous frame, clamped so a background-tab gap cannot
    // fire a huge jump. rAF timestamps can predate the scheduling
    // performance.now() by a hair, hence the lower clamp too.
    const elapsed = lastPanTs === null ? 0 : Math.min(64, Math.max(0, ts - lastPanTs));
    lastPanTs = ts;
    const stepX = dx * elapsed;
    const stepY = dy * elapsed;
    if (stepX !== 0 || stepY !== 0) {
      opts.panBy(stepX, stepY);
      for (const rect of active.rects) {
        rect.left += stepX;
        rect.top += stepY;
      }
      updateTarget(lastPointer.x, lastPointer.y);
    }
    panFrame = requestAnimationFrame(panStep);
  };

  const trackPan = (x: number, y: number) => {
    if (!opts.panBy) return;
    lastPointer = { x, y };
    if (!containerRect) containerRect = container.getBoundingClientRect();
    if (panFrame === null) {
      // Stamp the loop start so the very first frame already pans a correct
      // delta instead of acting as a dead primer frame.
      lastPanTs = performance.now();
      panFrame = requestAnimationFrame(panStep);
    }
  };

  const releaseCapture = () => {
    if (!captured) return;
    const { el, pointerId } = captured;
    captured = null;
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
  };

  const endDrag = (commit: boolean) => {
    if (!active) return;
    const state = active;
    active = null;
    document.body.style.cursor = "";
    stopPanLoop();
    releaseCapture();
    if (state.hoverTimer !== null) window.clearTimeout(state.hoverTimer);
    const sourceEl = container.querySelector(`[data-node-id="${state.nodeId}"]`);
    sourceEl?.classList.remove("dz-source");
    if (state.memberAuthId) {
      sourceEl
        ?.querySelector(`[data-member-id="${CSS.escape(state.memberAuthId)}"]`)
        ?.classList.remove("dz-source");
    }
    clearIndicatorsFor(state);

    if (commit && state.valid && state.targetId) {
      const zone = state.zone ?? { zone: "reject" as const, reason: "Drop on a card" };
      const verdict = state.memberAuthId
        ? validateMemberDrop(
            opts.getRows(),
            opts.getIndex(),
            state.nodeId,
            state.memberAuthId,
            state.targetId,
            zone,
          )
        : validateDrop(
            opts.getRows(),
            opts.getIndex(),
            state.nodeId,
            state.targetId,
            zone,
          );
      const drop = state.memberAuthId
        ? toMemberDrop(state.nodeId, state.memberAuthId, verdict, opts.getRows())
        : toDrop(state.nodeId, verdict, opts.getRows());
      state.ghost.remove();
      state.chip.remove();
      state.caret.remove();
      if (drop) opts.onDrop(drop);
      return;
    }

    if (!commit || state.targetId) {
      // Reject shake (or cancel): animate the ghost back briefly, then remove.
      state.ghost.classList.add("dz-shake");
      state.chip.remove();
      state.caret.remove();
      window.setTimeout(() => state.ghost.remove(), 350);
    } else {
      state.ghost.remove();
      state.chip.remove();
      state.caret.remove();
    }
  };

  const clearIndicatorsFor = (state: NonNullable<typeof active>) => {
    state.targetEl?.classList.remove(...ZONE_CLASSES);
    state.caret.style.display = "none";
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const card = (event.target as HTMLElement).closest("[data-node-id]");
    if (!card || !container.contains(card)) return;
    // A drag from a member's grip carries that person; elsewhere carries the seat.
    const grip = (event.target as HTMLElement).closest("[data-member-drag]");
    armed = {
      nodeId: card.getAttribute("data-node-id")!,
      memberAuthId:
        grip && card.contains(grip) ? grip.getAttribute("data-member-drag") : null,
      startX: event.clientX,
      startY: event.clientY,
    };
    card.setPointerCapture(event.pointerId);
    captured = { el: card, pointerId: event.pointerId };
  };

  const onPointerMove = (event: PointerEvent) => {
    if (armed) {
      const dx = event.clientX - armed.startX;
      const dy = event.clientY - armed.startY;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX)
        startDrag(event.clientX, event.clientY);
      return;
    }
    if (!active) return;
    event.preventDefault();
    moveGhost(event.clientX, event.clientY);
    updateTarget(event.clientX, event.clientY);
    trackPan(event.clientX, event.clientY);
  };

  const onPointerUp = () => {
    armed = null;
    if (active) endDrag(true);
  };

  const onPointerCancel = () => {
    armed = null;
    if (active) endDrag(false);
    else releaseCapture();
  };

  const onDragStart = (event: DragEvent) => {
    event.preventDefault();
  };

  const onClick = (event: MouseEvent) => {
    if (!didDrag) return;
    didDrag = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      armed = null;
      if (active) endDrag(false);
    }
  };

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("dragstart", onDragStart);
  container.addEventListener("click", onClick, true);
  document.addEventListener("pointermove", onPointerMove, { passive: false });
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerCancel);
  document.addEventListener("lostpointercapture", onPointerCancel);
  document.addEventListener("keydown", onKeyDown);

  return () => {
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("dragstart", onDragStart);
    container.removeEventListener("click", onClick, true);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerCancel);
    document.removeEventListener("lostpointercapture", onPointerCancel);
    document.removeEventListener("keydown", onKeyDown);
    if (active) endDrag(false);
    stopPanLoop();
    armed = null;
    didDrag = false;
    releaseCapture();
  };
}
