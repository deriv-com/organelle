/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ChartSearch } from "./chart-search";
import type { ChartRow } from "./chart-row";
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const rows: ChartRow[] = [
  {
    id: "root",
    parentId: "",
    kind: "header",
    name: "Example Organization",
    sortOrder: 0,
    rowVersion: 1,
    members: [],
  },
  ...["Alpha", "Beta"].map((name, i) => ({
    id: name,
    parentId: "root",
    kind: "header" as const,
    name: `Example ${name}`,
    sortOrder: i,
    rowVersion: 1,
    members: [],
  })),
];
it("navigates displayed search results from the input with arrow keys and Enter", () => {
  const select = vi.fn();
  const view = render(<ChartSearch rows={rows} onSelect={select} />);
  const input = view.getByRole("textbox", { name: "Search people and teams" });
  fireEvent.change(input, { target: { value: "Example" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowUp" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(select).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledWith("Beta");
});
