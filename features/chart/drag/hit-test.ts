/**
 * Pointer hit-test for chart drag. Pure geometry over cached
 * card rects — card interior always wins; left/right 40px strips are sibling
 * insert; overlapping gutters pick the closer card edge.
 */

export const GAP_STRIP_PX = 40;

export interface CardRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Hit {
  targetId: string | null;
  insideCard: boolean;
  relY: number;
  side: "left" | "right" | null;
}

const MISS: Hit = { targetId: null, insideCard: false, relY: 0.5, side: null };

function inBand(y: number, rect: CardRect): boolean {
  return y >= rect.top && y <= rect.top + rect.height;
}

export function hitTest(
  x: number,
  y: number,
  rects: CardRect[],
  sourceId: string,
): Hit {
  const others = rects.filter((rect) => rect.id !== sourceId);

  for (const rect of others) {
    if (!inBand(y, rect)) continue;
    if (x >= rect.left && x <= rect.left + rect.width) {
      return {
        targetId: rect.id,
        insideCard: true,
        relY: (y - rect.top) / rect.height,
        side: null,
      };
    }
  }

  let best: { id: string; side: "left" | "right"; dist: number; relY: number } | null =
    null;
  for (const rect of others) {
    if (!inBand(y, rect)) continue;
    const right = rect.left + rect.width;
    const relY = (y - rect.top) / rect.height;
    if (x >= rect.left - GAP_STRIP_PX && x < rect.left) {
      const dist = rect.left - x;
      if (!best || dist < best.dist) best = { id: rect.id, side: "left", dist, relY };
    }
    if (x > right && x <= right + GAP_STRIP_PX) {
      const dist = x - right;
      if (!best || dist < best.dist) best = { id: rect.id, side: "right", dist, relY };
    }
  }
  if (!best) return MISS;
  return { targetId: best.id, insideCard: false, relY: best.relY, side: best.side };
}
