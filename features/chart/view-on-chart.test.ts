import { afterEach, describe, expect, it } from "vitest";

import { useOrgData } from "@/store/org-data";
import {
  closeSandboxHistorySheet,
  directoryChartHref,
  isChartSurface,
  isSandboxChartSurface,
  shouldClearFocusOnNavigate,
  shouldCloseSandboxHistoryOnNavigate,
  viewSeatOnChart,
} from "./view-on-chart";

afterEach(() => {
  useOrgData.getState().clearFocusRequest();
  useOrgData.getState().setDrawerAuthId(null);
  useOrgData.getState().setHistoryOpen(false);
});

describe("isChartSurface", () => {
  it("treats live, sandbox edit, and version charts as in-tree", () => {
    expect(isChartSurface("/chart")).toBe(true);
    expect(isChartSurface("/sandbox/abc")).toBe(true);
    expect(isChartSurface("/versions/xyz")).toBe(true);
  });

  it("does not treat directory, merge, or list pages as chart surfaces", () => {
    expect(isChartSurface("/directory")).toBe(false);
    expect(isChartSurface("/sandbox/abc/merge")).toBe(false);
    expect(isChartSurface("/sandboxes")).toBe(false);
    expect(isChartSurface("/versions")).toBe(false);
  });
});

describe("shouldClearFocusOnNavigate", () => {
  it("drops leftover in-chart focus when leaving a chart surface", () => {
    expect(shouldClearFocusOnNavigate("/chart", "/directory")).toBe(true);
    expect(shouldClearFocusOnNavigate("/sandbox/abc", "/directory")).toBe(true);
  });

  it("keeps a directory View-on-chart request when arriving on the chart", () => {
    expect(shouldClearFocusOnNavigate("/directory", "/chart")).toBe(false);
    expect(shouldClearFocusOnNavigate("/chart", "/sandbox/abc")).toBe(false);
  });
});

describe("shouldCloseSandboxHistoryOnNavigate", () => {
  it("closes when leaving an editable sandbox chart", () => {
    expect(shouldCloseSandboxHistoryOnNavigate("/sandbox/abc", "/sandboxes")).toBe(
      true,
    );
    expect(shouldCloseSandboxHistoryOnNavigate("/sandbox/abc", "/chart")).toBe(true);
    expect(
      shouldCloseSandboxHistoryOnNavigate("/sandbox/abc", "/sandbox/abc/merge"),
    ).toBe(true);
  });

  it("does not close when staying on the same sandbox chart", () => {
    expect(shouldCloseSandboxHistoryOnNavigate("/sandbox/abc", "/sandbox/abc")).toBe(
      false,
    );
  });

  it("does not close when leaving non-sandbox chart surfaces", () => {
    expect(shouldCloseSandboxHistoryOnNavigate("/chart", "/directory")).toBe(false);
    expect(
      shouldCloseSandboxHistoryOnNavigate("/sandbox/abc/merge", "/sandboxes"),
    ).toBe(false);
  });
});

describe("isSandboxChartSurface", () => {
  it("matches only editable sandbox chart routes", () => {
    expect(isSandboxChartSurface("/sandbox/abc")).toBe(true);
    expect(isSandboxChartSurface("/sandbox/abc/merge")).toBe(false);
    expect(isSandboxChartSurface("/sandboxes")).toBe(false);
    expect(isSandboxChartSurface("/chart")).toBe(false);
  });
});

describe("closeSandboxHistorySheet", () => {
  it("clears historyOpen in the org-data store", () => {
    useOrgData.getState().setHistoryOpen(true);
    closeSandboxHistorySheet();
    expect(useOrgData.getState().historyOpen).toBe(false);
  });
});

describe("employee dialog origin", () => {
  it("stores the node where the employee dialog was opened", () => {
    useOrgData.getState().setDrawerAuthId("auth-a", "node-a");
    expect(useOrgData.getState().drawerAuthId).toBe("auth-a");
    expect(useOrgData.getState().drawerNodeId).toBe("node-a");

    useOrgData.getState().setDrawerAuthId(null);
    expect(useOrgData.getState().drawerNodeId).toBeNull();
  });
});

describe("viewSeatOnChart", () => {
  it("replaces a leftover chart focus so directory View on chart targets the new seat", () => {
    useOrgData.getState().setDrawerAuthId("auth-a");
    viewSeatOnChart("person-a", "/chart");
    expect(useOrgData.getState().focusRequest?.nodeId).toBe("person-a");
    expect(useOrgData.getState().drawerAuthId).toBeNull();

    useOrgData.getState().setDrawerAuthId("auth-b");
    viewSeatOnChart("person-b", "/directory");
    expect(useOrgData.getState().focusRequest?.nodeId).toBe("person-b");
    expect(useOrgData.getState().drawerAuthId).toBe("auth-b");
    expect(directoryChartHref("person-b")).toBe("/chart?focus=person-b");
  });
});
