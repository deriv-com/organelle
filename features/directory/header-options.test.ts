import { describe, expect, it } from "vitest";

import type { ChartRow } from "@/features/chart/chart-row";
import { buildHeaderOptions } from "./header-options";

function seat(id: string, parentId: string): ChartRow {
  return { id, parentId, kind: "seat", sortOrder: 0, rowVersion: 1, members: [] };
}

function header(id: string, parentId: string, name: string, sortOrder = 0): ChartRow {
  return { id, parentId, kind: "header", sortOrder, rowVersion: 1, name, members: [] };
}

describe("buildHeaderOptions", () => {
  it("nests child headers under their parent, sorted by name", () => {
    const rows: ChartRow[] = [
      seat("root", ""),
      header("team", "dept", "Platform"),
      header("dept", "root", "Engineering"),
      header("other", "root", "Compliance", 1),
    ];

    expect(buildHeaderOptions(rows)).toEqual([
      { id: "other", name: "Compliance", children: [] },
      {
        id: "dept",
        name: "Engineering",
        children: [{ id: "team", name: "Platform", children: [] }],
      },
    ]);
  });

  it("skips intermediate seat parents so teams stay under their department", () => {
    // The real published shape: departments hang under the Publisher seat and teams hang
    // under a manager seat inside the department.
    const rows: ChartRow[] = [
      seat("publisher", ""),
      header("eng", "publisher", "Engineering"),
      seat("eng-manager", "eng"),
      header("platform", "eng-manager", "Platform"),
      seat("team-lead", "platform"),
      header("infra", "team-lead", "Infra"),
    ];

    expect(buildHeaderOptions(rows)).toEqual([
      {
        id: "eng",
        name: "Engineering",
        children: [
          {
            id: "platform",
            name: "Platform",
            children: [{ id: "infra", name: "Infra", children: [] }],
          },
        ],
      },
    ]);
  });

  it("returns an empty list when the tree has no headers", () => {
    expect(buildHeaderOptions([seat("root", ""), seat("child", "root")])).toEqual([]);
  });
});
