import { afterEach, describe, expect, it } from "vitest";

import { useOrgData } from "./org-data";
import type { ChartRow } from "@/features/chart/chart-row";

const initial = useOrgData.getState();

function row(id: string): ChartRow {
  return {
    id,
    parentId: "",
    kind: "seat",
    sortOrder: 0,
    rowVersion: 1,
    members: [],
  };
}

afterEach(() => useOrgData.setState(initial, true));

describe("org data chart rows", () => {
  it("publishes optimistic rows for the global employee dialog immediately", () => {
    const created = row("new-seat");

    useOrgData.getState().setChartRows([created]);

    expect(useOrgData.getState().chartRows).toEqual([created]);
  });
});
