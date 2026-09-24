/**
 * Edge auto-pan velocity during a drag.
 *
 * When the pointer is held within EDGE_MARGIN_PX of a container edge, the chart
 * pans in that direction so faraway drop targets can be reached without
 * releasing the drag. Speed ramps linearly from 0 at the margin boundary to
 * MAX_PX_PER_MS at the edge and stays at max for a small overshoot past the
 * container; far outside (over the topbar, another window) returns zero so
 * the camera does not run away.
 *
 * Pure function over the container's bounding rect — no DOM access, so the
 * drag controller can unit-test the ramp and reuse the container rect it
 * already measures once per drag.
 */

/** Distance from a container edge where auto-pan engages. */
export const EDGE_MARGIN_PX = 56;

/** Peak pan speed at the edge, in px per ms (~15px per frame at 60fps). */
export const MAX_PX_PER_MS = 0.9;

/**
 * Extra distance past the container edge that still pans at full speed.
 * Covers pointers resting just outside the window edge.
 */
export const EDGE_OVERSHOOT_PX = 24;

export interface EdgePanRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const axisVelocity = (position: number, start: number, end: number): number => {
  if (position < start - EDGE_OVERSHOOT_PX || position > end + EDGE_OVERSHOOT_PX) {
    return 0;
  }
  if (position < start + EDGE_MARGIN_PX) {
    // Near the start edge: 0 at the margin boundary, +MAX at/past the edge —
    // content slides toward the end, revealing what lies before the start.
    return (
      clamp01((start + EDGE_MARGIN_PX - position) / EDGE_MARGIN_PX) * MAX_PX_PER_MS
    );
  }
  if (position > end - EDGE_MARGIN_PX) {
    // Near the end edge: 0 at the margin boundary, -MAX at/past the edge —
    // content slides toward the start, revealing what lies past the end.
    return (
      -clamp01((position - (end - EDGE_MARGIN_PX)) / EDGE_MARGIN_PX) * MAX_PX_PER_MS
    );
  }
  return 0;
};

/**
 * Camera translation velocity in px/ms for a pointer at (clientX, clientY):
 * on-screen content (and the cached hit-test rects) slide by (dx, dy). Both
 * components are 0 when the pointer rests in the container interior.
 */
export function edgePanVelocity(
  clientX: number,
  clientY: number,
  rect: EdgePanRect,
): { dx: number; dy: number } {
  return {
    dx: axisVelocity(clientX, rect.left, rect.right),
    dy: axisVelocity(clientY, rect.top, rect.bottom),
  };
}
