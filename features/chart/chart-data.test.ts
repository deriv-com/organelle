import { describe, expect, it } from "vitest";

import type { TreePayload, TreeQueryRow } from "./tree-query";
import { buildChart, EDITOR_ONLY_MEMBER_KEYS, EDITOR_ONLY_ROW_KEYS } from "./chart-row";
import {
  buildChartSnapshot,
  clearPublishedChartSnapshotCache,
  getCachedPublishedChartSnapshot,
  rememberPublishedChartSnapshot,
} from "./chart-data";

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

describe("buildChartSnapshot", () => {
  it("uses buildChart as the source for API chart rows", () => {
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

    expect(buildChartSnapshot(payload)).toEqual({
      treeId: payload.treeId,
      versionSeq: payload.versionSeq,
      publishedAt: payload.publishedAt,
      rows: expect.any(Array),
    });
  });

  it("serializes only the allowlisted published row and member fields", () => {
    const payload: TreePayload = {
      treeId: "published-tree",
      versionSeq: 1,
      publishedAt: null,
      rows: [
        row("root", null, "seat"),
        row("seat-a", "root", "seat", {
          full_name: "SECRET_SAGE_NAME",
          employee_job_title: "SECRET_SAGE_TITLE",
          employee_avatar_url: "https://example.com/secret-source.png",
          job_title: "SECRET_SEAT_TITLE",
          position_level: 8,
          employee_position_level: 5,
          status: "serving_notice",
          row_version: 42,
          override_auth_id: "seat-a",
          override_display_name: "Amy",
          override_display_title: "SECRET_OVERRIDE_TITLE",
          override_avatar_url: "https://example.com/public.png",
          override_position_level: 5,
          override_legal_full_name: "Amy Legal",
          legal_full_name: "Amy Legal",
          employment_record: "2024.01 #1",
          resignation_date: "2026-12-31",
          last_working_date: "2026-12-31",
        }),
      ],
    };

    const internal = buildChart(payload.rows).rows;
    expect(internal[1]).toMatchObject({
      rowVersion: 42,
      jobTitle: "SECRET_SEAT_TITLE",
      positionLevel: 8,
    });
    expect(internal[1]?.members[0]).toMatchObject({
      displayTitle: "SECRET_OVERRIDE_TITLE",
      sourceName: "SECRET_SAGE_NAME",
      sourceTitle: "SECRET_SAGE_TITLE",
      overrideTitle: "SECRET_OVERRIDE_TITLE",
      legalFullName: "Amy Legal",
    });

    const snapshot = buildChartSnapshot(payload);
    const publicRow = snapshot.rows[1];
    const member = publicRow?.members[0];
    expect(member?.displayName).toBe("Amy");
    expect(member?.avatarUrl).toBe("https://example.com/public.png");
    expect(member?.servingNoticeMuted).toBe(false);
    for (const key of EDITOR_ONLY_MEMBER_KEYS) {
      expect(member).not.toHaveProperty(key);
    }
    for (const key of EDITOR_ONLY_ROW_KEYS) {
      expect(publicRow).not.toHaveProperty(key);
    }

    const json = JSON.stringify(snapshot);
    expect(json).not.toContain("SECRET_SAGE_NAME");
    expect(json).not.toContain("SECRET_SAGE_TITLE");
    expect(json).not.toContain("SECRET_OVERRIDE_TITLE");
    expect(json).not.toContain("SECRET_SEAT_TITLE");
    expect(json).not.toContain("secret-source.png");
  });
});

describe("published chart snapshot cache", () => {
  it("reuses snapshots only for the same published tree version and override freshness", () => {
    clearPublishedChartSnapshotCache();
    const snapshot = buildChartSnapshot({
      treeId: "published-tree",
      versionSeq: 7,
      publishedAt: null,
      rows: [row("root", null, "seat")],
    });
    const meta = { treeId: "published-tree", versionSeq: 7, publishedAt: null };

    rememberPublishedChartSnapshot(
      meta,
      "2026-08-20T00:00:00.000Z",
      "status-key-1",
      snapshot,
    );

    expect(
      getCachedPublishedChartSnapshot(meta, "2026-08-20T00:00:00.000Z", "status-key-1"),
    ).toBe(snapshot);
    expect(
      getCachedPublishedChartSnapshot(
        { ...meta, versionSeq: 8 },
        "2026-08-20T00:00:00.000Z",
        "status-key-1",
      ),
    ).toBeNull();
    expect(
      getCachedPublishedChartSnapshot(meta, "2026-08-20T00:01:00.000Z", "status-key-1"),
    ).toBeNull();
    expect(
      getCachedPublishedChartSnapshot(meta, "2026-08-20T00:00:00.000Z", "status-key-2"),
    ).toBeNull();
  });
});
