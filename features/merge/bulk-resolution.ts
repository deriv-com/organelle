import type { Conflict, Resolution } from "./types";

/** Map the user-facing chart side to the equivalent legal conflict resolution. */
export function bulkResolutionFor(
  conflict: Conflict,
  side: "live" | "sandbox",
): Resolution | null {
  if (side === "live") {
    if (conflict.allowed.includes("use_live")) return { choice: "use_live" };
    if (conflict.allowed.includes("drop")) return { choice: "drop" };
    return null;
  }

  if (conflict.allowed.includes("use_sandbox")) return { choice: "use_sandbox" };
  if (conflict.allowed.includes("recreate")) return { choice: "recreate" };
  return null;
}
