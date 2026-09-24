/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DataTablePagination, pageWindow } from "./data-table-pagination";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("builds compact page windows", () => {
  expect(pageWindow(1, 4)).toEqual([1, 2, 3, 4]);
  expect(pageWindow(5, 12)).toEqual([1, "ellipsis", 4, 5, 6, "ellipsis", 12]);
});

it("supports client navigation and real page URLs", () => {
  const onPageChange = vi.fn();
  render(
    <DataTablePagination
      page={1}
      pageCount={3}
      onPageChange={onPageChange}
      getPageHref={(page) => `/audit?page=${page}`}
    />,
  );

  const pageTwo = screen.getByRole("link", { name: "2" });
  expect(pageTwo.getAttribute("href")).toBe("/audit?page=2");
  fireEvent.click(pageTwo);
  expect(onPageChange).toHaveBeenCalledWith(2);
});
