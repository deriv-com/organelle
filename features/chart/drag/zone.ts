/**
 * Drop-zone classifier. Pure geometry → operation;
 * no DOM, no validation (validate.ts owns the reject rules).
 *
 * Inside the card: headers take the drop as a child anywhere; seats split into
 * peer (top quarter) and child (lower three-quarters). Outside: left/right gap
 * strips are sibling insert / reorder; a miss is empty canvas.
 */

export type Zone =
  | { zone: "child" }
  | { zone: "peer" }
  | { zone: "sibling-before" }
  | { zone: "sibling-after" }
  | { zone: "reject"; reason: string };

export interface ZonePoint {
  /** Within the card itself (false = miss / gap strip). */
  insideCard: boolean;
  /** Vertical position within the card, 0 (top) to 1 (bottom). */
  relY: number;
  /** Left/right of the card when `insideCard` is false. */
  side: "left" | "right" | null;
}

/** Fraction of a seat card's height that is the peer zone, measured from the
 *  top. The rest is child — child is the primary action. */
export const PEER_ZONE_FRACTION = 1 / 4;

export function classifyZone(
  target: { kind: "header" | "seat" } | null,
  point: ZonePoint,
): Zone {
  if (!target) return { zone: "reject", reason: "Drop on a card" };
  if (!point.insideCard) {
    if (point.side === "left") return { zone: "sibling-before" };
    if (point.side === "right") return { zone: "sibling-after" };
    return { zone: "reject", reason: "Drop on a card" };
  }
  if (target.kind === "header") return { zone: "child" };
  return point.relY > PEER_ZONE_FRACTION ? { zone: "child" } : { zone: "peer" };
}
