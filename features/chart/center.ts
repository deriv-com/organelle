/**
 * Viewport camera for search focus. Top layout: node.x is the card
 * centre, node.y is the top edge — same as d3-org-chart's nodeUpdateTransform.
 *
 * The library's `_centered` path calls `fit({ animate: true, scale: false })`,
 * which always schedules `svg.transition().call(zoom.transform)`. Even with
 * duration 0 that transition starts on the next frame; interrupting it (so pan
 * is not blocked) cancels the camera. Apply this transform with
 * `zoomBehavior.transform` and no transition instead.
 *
 * Undo/redo motion (04): stay if the destination card intersects the inset
 * viewport; otherwise ease-pan with a named `camera` transition.
 */

import { zoomIdentity, type ZoomTransform } from "d3";

export const VIEWPORT_INSET_PX = 16;

export function cardCenterTransform({
  nodeX,
  nodeY,
  nodeHeight,
  svgWidth,
  svgHeight,
  scale,
}: {
  nodeX: number;
  nodeY: number;
  nodeHeight: number;
  svgWidth: number;
  svgHeight: number;
  scale: number;
}): ZoomTransform {
  const cx = nodeX;
  const cy = nodeY + nodeHeight / 2;
  return zoomIdentity
    .translate(svgWidth / 2, svgHeight / 2)
    .scale(scale)
    .translate(-cx, -cy);
}

/** True when the card's screen rect intersects the inset viewport. */
export function nodeInViewport({
  nodeX,
  nodeY,
  nodeWidth,
  nodeHeight,
  transform,
  svgWidth,
  svgHeight,
  inset = VIEWPORT_INSET_PX,
}: {
  nodeX: number;
  nodeY: number;
  nodeWidth: number;
  nodeHeight: number;
  transform: { x: number; y: number; k: number };
  svgWidth: number;
  svgHeight: number;
  inset?: number;
}): boolean {
  const k = Number(transform.k) || 1;
  const tx = Number(transform.x) || 0;
  const ty = Number(transform.y) || 0;
  const screenLeft = (nodeX - nodeWidth / 2) * k + tx;
  const screenTop = nodeY * k + ty;
  const screenRight = (nodeX + nodeWidth / 2) * k + tx;
  const screenBottom = (nodeY + nodeHeight) * k + ty;
  return (
    screenRight > inset &&
    screenBottom > inset &&
    screenLeft < svgWidth - inset &&
    screenTop < svgHeight - inset
  );
}
