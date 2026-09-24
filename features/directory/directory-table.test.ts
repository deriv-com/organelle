/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import { PAGE_SIZE } from "./directory-table";

describe("directory table", () => {
  it("pages 25 seats at a time", () => {
    expect(PAGE_SIZE).toBe(25);
  });
});
