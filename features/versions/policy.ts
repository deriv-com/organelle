export type PublishedKind = "published" | "historical";

/** Restore copies a historical tree forward. Live and sandboxes are rejected. */
export function restoreSourceAllowed(
  kind: string,
): { ok: true } | { ok: false; reason: string } {
  if (kind === "published") return { ok: false, reason: "Already live" };
  if (kind !== "historical") return { ok: false, reason: "Not a published version" };
  return { ok: true };
}

export type MergeCounts = {
  moves?: number;
  edits?: number;
  creates?: number;
  deletes?: number;
  peers?: number;
};

export function formatMergeCounts(counts: MergeCounts | null): string | null {
  if (!counts) return null;
  const parts: string[] = [];
  for (const key of ["moves", "edits", "creates", "deletes", "peers"] as const) {
    const n = counts[key];
    if (typeof n === "number" && n > 0) parts.push(`${n} ${key}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
