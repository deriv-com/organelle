/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { select } from "d3-selection";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChartRow } from "./chart-row";
import OrgChartView from "./org-chart";

const { FakeChart, charts } = vi.hoisted(() => {
  const charts: InstanceType<typeof FakeChart>[] = [];

  class FakeChart {
    id = `ID${Math.floor(Math.random() * 1_000_000)}`;
    onExpandChip?: unknown;
    clearCalls = 0;

    constructor() {
      charts.push(this);
    }

    container() {
      return this;
    }
    data() {
      return this;
    }
    nodeId() {
      return this;
    }
    parentNodeId() {
      return this;
    }
    layout() {
      return this;
    }
    nodeWidth() {
      return this;
    }
    nodeHeight() {
      return this;
    }
    nodeButtonWidth() {
      return this;
    }
    nodeButtonHeight() {
      return this;
    }
    nodeButtonX() {
      return this;
    }
    nodeButtonY() {
      return this;
    }
    nodeContent() {
      return this;
    }
    buttonContent() {
      return this;
    }
    onNodeClick() {
      return this;
    }
    onZoom() {
      return this;
    }
    minPagingVisibleNodes() {
      return this;
    }
    pagingStep() {
      return this;
    }
    compact() {
      return this;
    }
    duration() {
      return this;
    }
    svgWidth() {
      return this;
    }
    svgHeight() {
      return this;
    }
    restyleForeignObjectElements() {
      return this;
    }
    fit() {
      return this;
    }

    render() {
      select(window).on(`resize.${this.id}`, () => {});
      return this;
    }

    getChartState() {
      return {
        id: this.id,
        svg: { interrupt: () => {}, node: () => null },
        zoomBehavior: null,
        lastTransform: { x: 0, y: 0, k: 1 },
        allNodes: [],
      };
    }

    clear() {
      this.clearCalls += 1;
      select(window).on(`resize.${this.id}`, null);
    }
  }

  return { FakeChart, charts };
});

vi.mock("./grid-org-chart", () => ({
  GridOrgChart: FakeChart,
}));

function row(id: string, parentId: string): ChartRow {
  return {
    id,
    parentId,
    kind: parentId === "" ? "header" : "seat",
    sortOrder: 0,
    rowVersion: 1,
    members: [],
  };
}

function resizeListeners(): { type: string; name: string }[] {
  const node = select(window).node() as
    (Window & { __on?: { type: string; name: string }[] }) | null;
  return (node?.__on ?? []).filter((listener) => listener.type === "resize");
}

describe("OrgChartView unmount", () => {
  beforeEach(() => {
    class ResizeObserverStub {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });

  afterEach(() => {
    cleanup();
    charts.length = 0;
    select(window).on("resize", null);
    vi.unstubAllGlobals();
  });

  it("calls chart.clear() exactly once and drops the d3 window resize listener", () => {
    const rows = [row("root", ""), row("child", "root")];
    const { unmount } = render(<OrgChartView treeId="tree-1" rows={rows} />);

    expect(charts).toHaveLength(1);
    expect(resizeListeners().some((listener) => listener.name === charts[0]!.id)).toBe(
      true,
    );
    expect(charts[0]!.clearCalls).toBe(0);

    unmount();

    expect(charts[0]!.clearCalls).toBe(1);
    expect(resizeListeners()).toEqual([]);
  });
});
