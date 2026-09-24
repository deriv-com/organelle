import { describe, expect, it } from "vitest";

import {
  buildHeaderTree,
  headerLevelAtDepth,
  publishedVersionLabel,
  type StructureNodeRow,
} from "./header-tree";

const OPTS = { versionSeq: 12 };

describe("headerLevelAtDepth", () => {
  it("maps depth to department / team_level_n labels", () => {
    expect(headerLevelAtDepth(0)).toBe("root");
    expect(headerLevelAtDepth(1)).toBe("department");
    expect(headerLevelAtDepth(2)).toBe("team_level_1");
    expect(headerLevelAtDepth(3)).toBe("team_level_2");
    expect(headerLevelAtDepth(4)).toBe("team_level_3");
  });
});

describe("publishedVersionLabel", () => {
  it("formats version_seq like the versions UI", () => {
    expect(publishedVersionLabel(1)).toBe("v1");
    expect(publishedVersionLabel(12)).toBe("v12");
  });
});

describe("buildHeaderTree", () => {
  it("nests headers by parent and sorts siblings by sort_order", () => {
    const rows: StructureNodeRow[] = [
      {
        node_id: "root",
        parent_node_id: null,
        node_type: "header",
        name: "Company",
        sort_order: 0,
      },
      {
        node_id: "b",
        parent_node_id: "root",
        node_type: "header",
        name: "Beta",
        sort_order: 2,
      },
      {
        node_id: "a",
        parent_node_id: "root",
        node_type: "header",
        name: "Alpha",
        sort_order: 1,
      },
      {
        node_id: "a1",
        parent_node_id: "a",
        node_type: "header",
        name: "Alpha One",
        sort_order: 0,
      },
    ];

    expect(buildHeaderTree(rows, OPTS)).toEqual({
      name: "Company",
      level: "root",
      children: [
        {
          name: "Alpha",
          level: "department",
          children: [{ name: "Alpha One", level: "team_level_1", children: [] }],
        },
        { name: "Beta", level: "department", children: [] },
      ],
    });
  });

  it("names the seat-root wrapper from published version_seq", () => {
    const rows: StructureNodeRow[] = [
      {
        node_id: "publisher-seat",
        parent_node_id: null,
        node_type: "seat",
        name: null,
        sort_order: 0,
      },
      {
        node_id: "eng",
        parent_node_id: "publisher-seat",
        node_type: "header",
        name: "Engineering",
        sort_order: 1,
      },
      {
        node_id: "sales",
        parent_node_id: "publisher-seat",
        node_type: "header",
        name: "Sales",
        sort_order: 0,
      },
      {
        node_id: "platform",
        parent_node_id: "eng",
        node_type: "header",
        name: "Platform",
        sort_order: 0,
      },
      {
        node_id: "infra",
        parent_node_id: "platform",
        node_type: "header",
        name: "Infra",
        sort_order: 0,
      },
    ];

    expect(buildHeaderTree(rows, OPTS)).toEqual({
      name: "v12",
      level: "root",
      children: [
        { name: "Sales", level: "department", children: [] },
        {
          name: "Engineering",
          level: "department",
          children: [
            {
              name: "Platform",
              level: "team_level_1",
              children: [{ name: "Infra", level: "team_level_2", children: [] }],
            },
          ],
        },
      ],
    });
  });

  it("skips intermediate seat parents under a header", () => {
    const rows: StructureNodeRow[] = [
      {
        node_id: "root",
        parent_node_id: null,
        node_type: "header",
        name: "Company",
        sort_order: 0,
      },
      {
        node_id: "mgr",
        parent_node_id: "root",
        node_type: "seat",
        name: null,
        sort_order: 0,
      },
      {
        node_id: "eng",
        parent_node_id: "mgr",
        node_type: "header",
        name: "Engineering",
        sort_order: 0,
      },
    ];

    expect(buildHeaderTree(rows, OPTS)).toEqual({
      name: "Company",
      level: "root",
      children: [{ name: "Engineering", level: "department", children: [] }],
    });
  });

  it("does not include seats or node ids in the JSON tree", () => {
    const rows: StructureNodeRow[] = [
      {
        node_id: "publisher",
        parent_node_id: null,
        node_type: "seat",
        name: null,
        sort_order: 0,
      },
      {
        node_id: "dept",
        parent_node_id: "publisher",
        node_type: "header",
        name: "Dept",
        sort_order: 0,
      },
      {
        node_id: "ic",
        parent_node_id: "dept",
        node_type: "seat",
        name: null,
        sort_order: 0,
      },
    ];
    const tree = buildHeaderTree(rows, { versionSeq: 3 });
    expect(tree).toEqual({
      name: "v3",
      level: "root",
      children: [{ name: "Dept", level: "department", children: [] }],
    });
    expect(JSON.stringify(tree)).not.toContain("node_id");
    expect(JSON.stringify(tree)).not.toContain("publisher");
  });

  it("throws when there are no headers", () => {
    expect(() =>
      buildHeaderTree(
        [
          {
            node_id: "seat",
            parent_node_id: null,
            node_type: "seat",
            name: null,
            sort_order: 0,
          },
        ],
        OPTS,
      ),
    ).toThrow(/no headers/);
  });
});
