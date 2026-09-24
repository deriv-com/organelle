import { describe, expect, it } from "vitest";

import { buildChart, toPublicChartRows } from "@/features/chart/chart-row";
import type { SandboxPayload, TreeQueryRow } from "@/features/chart/tree-query";
import {
  buildVersionChartSnapshot,
  clearVersionChartSnapshotCache,
  getCachedVersionChartSnapshot,
  getVersionChartSnapshotCacheSize,
  rememberVersionChartSnapshot,
} from "./version-chart-data";

function row(
  nodeId: string,
  parentNodeId: string | null,
  nodeType: "header" | "seat",
  overrides: Partial<TreeQueryRow> = {},
): TreeQueryRow {
  return {
    node_id: nodeId,
    parent_node_id: parentNodeId,
    node_type: nodeType,
    sort_order: 0,
    row_version: 1,
    name: nodeType === "header" ? nodeId : null,
    job_title: nodeType === "seat" ? `${nodeId} title` : null,
    position_level: null,
    is_assistant: false,
    leaf_grid_columns: 3,
    employee_auth_id: nodeType === "seat" ? nodeId : null,
    is_host: nodeType === "seat" ? true : null,
    full_name: nodeType === "seat" ? `Person ${nodeId}` : null,
    email: nodeType === "seat" ? `${nodeId}@example.com` : null,
    employee_job_title: nodeType === "seat" ? `${nodeId} employee title` : null,
    employee_avatar_url: null,
    office_location: nodeType === "seat" ? "Dubai" : null,
    status: nodeType === "seat" ? "active" : null,
    joining_date: null,
    override_display_name: null,
    override_display_title: null,
    override_avatar_url: null,
    ...overrides,
  };
}

function payload(
  treeId: string,
  kind: SandboxPayload["kind"],
  rows: TreeQueryRow[] = [row("root", null, "seat")],
): SandboxPayload {
  return {
    treeId,
    name: "Tree",
    kind,
    archived: false,
    ownerAuthId: null,
    versionSeq: kind === "sandbox" ? null : 7,
    forkedFromSeq: 0,
    forkedFromTreeId: null,
    rows,
  };
}

describe("buildVersionChartSnapshot", () => {
  it("uses buildChart for published and historical version rows", () => {
    const source = payload("version-tree", "historical", [
      row("root", null, "seat"),
      row("dept", "root", "header", { name: "Engineering" }),
      row("seat-a", "dept", "seat", { full_name: "Amy" }),
    ]);

    const snapshot = buildVersionChartSnapshot(source);
    expect(snapshot).toEqual({
      treeId: source.treeId,
      treeKind: source.kind,
      versionSeq: source.versionSeq,
      rows: toPublicChartRows(buildChart(source.rows).rows),
    });
    expect(snapshot?.rows[0]).not.toHaveProperty("rowVersion");
    expect(snapshot?.rows[0]).not.toHaveProperty("jobTitle");
    expect(snapshot?.rows[0]?.members[0]).not.toHaveProperty("displayTitle");
    expect(snapshot?.rows[0]?.members[0]).not.toHaveProperty("sourceName");
    expect(JSON.stringify(snapshot)).not.toContain("root employee title");
    expect(JSON.stringify(snapshot)).not.toContain("root title");
  });

  it("rejects sandbox trees", () => {
    expect(buildVersionChartSnapshot(payload("sandbox-tree", "sandbox"))).toBeNull();
  });
});

describe("version chart snapshot cache", () => {
  it("reuses snapshots only for the same tree and override freshness", () => {
    clearVersionChartSnapshotCache();
    const snapshot = buildVersionChartSnapshot(payload("version-tree", "historical"))!;

    rememberVersionChartSnapshot(
      snapshot.treeId,
      "2026-08-20T00:00:00.000Z",
      "status-key-1",
      snapshot,
    );

    expect(
      getCachedVersionChartSnapshot(
        "version-tree",
        "2026-08-20T00:00:00.000Z",
        "status-key-1",
      ),
    ).toBe(snapshot);
    expect(
      getCachedVersionChartSnapshot(
        "other-tree",
        "2026-08-20T00:00:00.000Z",
        "status-key-1",
      ),
    ).toBeNull();
    expect(
      getCachedVersionChartSnapshot(
        "version-tree",
        "2026-08-20T00:01:00.000Z",
        "status-key-1",
      ),
    ).toBeNull();
    expect(
      getCachedVersionChartSnapshot(
        "version-tree",
        "2026-08-20T00:00:00.000Z",
        "status-key-2",
      ),
    ).toBeNull();
  });

  it("keeps the cache bounded by dropping least-recent entries", () => {
    clearVersionChartSnapshotCache();
    const first = buildVersionChartSnapshot(payload("tree-1", "historical"))!;
    const second = buildVersionChartSnapshot(payload("tree-2", "historical"))!;
    const third = buildVersionChartSnapshot(payload("tree-3", "historical"))!;

    rememberVersionChartSnapshot(first.treeId, null, "status-key-1", first, 2);
    rememberVersionChartSnapshot(second.treeId, null, "status-key-1", second, 2);
    rememberVersionChartSnapshot(third.treeId, null, "status-key-1", third, 2);

    expect(getVersionChartSnapshotCacheSize()).toBe(2);
    expect(getCachedVersionChartSnapshot("tree-1", null, "status-key-1")).toBeNull();
    expect(getCachedVersionChartSnapshot("tree-2", null, "status-key-1")).toBe(second);
    expect(getCachedVersionChartSnapshot("tree-3", null, "status-key-1")).toBe(third);
  });
});
