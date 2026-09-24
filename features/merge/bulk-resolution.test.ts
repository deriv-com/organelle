import { describe, expect, it } from "vitest";

import { bulkResolutionFor } from "./bulk-resolution";
import type { Conflict } from "./types";

function conflict(allowed: Conflict["allowed"]): Conflict {
  return {
    key: "test",
    kind: "concurrent_move",
    nodeId: "node",
    field: "parent",
    sentence: "",
    label: "Test",
    live: { exists: true, parentLabel: null, title: null },
    sandbox: { exists: true, parentLabel: null, title: null },
    allowed,
  };
}

describe("bulkResolutionFor", () => {
  it("maps stale-source delete conflicts to each chart side", () => {
    const staleSource = conflict(["recreate", "drop"]);

    expect(bulkResolutionFor(staleSource, "live")).toEqual({ choice: "drop" });
    expect(bulkResolutionFor(staleSource, "sandbox")).toEqual({ choice: "recreate" });
  });

  it("leaves an impossible sandbox destination for manual selection", () => {
    const staleTarget = conflict(["pick_new_target", "drop"]);

    expect(bulkResolutionFor(staleTarget, "live")).toEqual({ choice: "drop" });
    expect(bulkResolutionFor(staleTarget, "sandbox")).toBeNull();
  });
});
