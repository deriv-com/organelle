import { describe, expect, it } from "vitest";

import type { TreeQueryRow, TreePayload } from "@/features/chart/tree-query";
import { buildChart } from "@/features/chart/chart-row";
import { buildDirectoryRows, toPublicDirectoryRows } from "./directory-row";
import {
  buildDirectorySnapshot,
  clearPublishedDirectorySnapshotCache,
  getCachedPublishedDirectorySnapshot,
  rememberPublishedDirectorySnapshot,
} from "./directory-data";
import { buildHeaderOptions } from "./header-options";

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

describe("buildDirectorySnapshot", () => {
  it("uses the chart tree builder as the source for directory rows and headers", () => {
    const payload: TreePayload = {
      treeId: "published-tree",
      versionSeq: 7,
      publishedAt: "2026-08-20T00:00:00.000Z",
      rows: [
        row("root", null, "seat"),
        row("dept", "root", "header", { name: "Engineering" }),
        row("seat-a", "dept", "seat", { full_name: "Amy" }),
      ],
    };

    const chart = buildChart(payload.rows).rows;
    const snapshot = buildDirectorySnapshot(payload);

    expect(snapshot).toEqual({
      treeId: payload.treeId,
      versionSeq: payload.versionSeq,
      publishedAt: payload.publishedAt,
      rows: toPublicDirectoryRows(buildDirectoryRows(chart)),
      headers: buildHeaderOptions(chart),
    });
    expect(snapshot.rows[0]).not.toHaveProperty("jobTitle");
    expect(snapshot.rows[0]?.host).not.toHaveProperty("displayTitle");
    expect(snapshot.rows[0]?.host).not.toHaveProperty("sourceName");
    expect(snapshot.rows[0]?.host).not.toHaveProperty("overrideName");
    expect(JSON.stringify(snapshot)).not.toContain("root employee title");
    expect(JSON.stringify(snapshot)).not.toContain("root title");
  });
});

describe("published directory snapshot cache", () => {
  it("reuses snapshots only for the same published tree version and override freshness", () => {
    clearPublishedDirectorySnapshotCache();
    const snapshot = buildDirectorySnapshot({
      treeId: "published-tree",
      versionSeq: 7,
      publishedAt: null,
      rows: [row("root", null, "seat")],
    });
    const meta = { treeId: "published-tree", versionSeq: 7, publishedAt: null };

    rememberPublishedDirectorySnapshot(
      meta,
      "2026-08-20T00:00:00.000Z",
      "status-key-1",
      snapshot,
    );

    expect(
      getCachedPublishedDirectorySnapshot(
        meta,
        "2026-08-20T00:00:00.000Z",
        "status-key-1",
      ),
    ).toBe(snapshot);
    expect(
      getCachedPublishedDirectorySnapshot(
        { ...meta, versionSeq: 8 },
        "2026-08-20T00:00:00.000Z",
        "status-key-1",
      ),
    ).toBeNull();
    expect(
      getCachedPublishedDirectorySnapshot(
        meta,
        "2026-08-20T00:01:00.000Z",
        "status-key-1",
      ),
    ).toBeNull();
    expect(
      getCachedPublishedDirectorySnapshot(
        meta,
        "2026-08-20T00:00:00.000Z",
        "status-key-2",
      ),
    ).toBeNull();
  });
});
