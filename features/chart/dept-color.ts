/**
 * Department family colours. Keyed by top-level header node_id,
 * unique among the current set until the 24-slot palette is exhausted.
 *
 * Complementary pairing (warm/cool) — not a 15° rainbow — so neighbouring
 * slots stay distinct after the header fill tint.
 */
const PALETTE = [
  "#ef4444",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#eab308",
  "#d946ef",
  "#22c55e",
  "#ec4899",
  "#0ea5e9",
  "#8b5cf6",
  "#84cc16",
  "#f43f5e",
  "#06b6d4",
  "#f59e0b",
  "#3b82f6",
  "#a855f7",
  "#10b981",
  "#fb7185",
  "#2dd4bf",
  "#fb923c",
  "#818cf8",
  "#e879f9",
  "#4ade80",
  "#f472b6",
];
const NEUTRAL = "#6b7280";
/** Coprime with 24: collision walk lands on a complementary slot, not the next hue. */
const SLOT_STEP = 11;

function hashId(id: string): number {
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** One colour per department id. Unique while `ids.length <= PALETTE.length`. */
export function assignDeptColors(ids: string[]): Map<string, string> {
  const sorted = [...ids].sort();
  const used = new Set<number>();
  const colors = new Map<string, string>();
  for (const id of sorted) {
    const preferred = hashId(id) % PALETTE.length;
    if (used.size >= PALETTE.length) {
      colors.set(id, PALETTE[preferred]!);
      continue;
    }
    let slot = preferred;
    while (used.has(slot)) slot = (slot + SLOT_STEP) % PALETTE.length;
    used.add(slot);
    colors.set(id, PALETTE[slot]!);
  }
  return colors;
}

export function deptColor(deptId: string | null, colors?: Map<string, string>): string {
  if (!deptId || !colors) return NEUTRAL;
  return colors.get(deptId) ?? NEUTRAL;
}
