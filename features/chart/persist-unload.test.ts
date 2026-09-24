import { describe, expect, it } from "vitest";

import { shouldWarnOnUnload } from "./persist-unload";

describe("shouldWarnOnUnload", () => {
  it("warns only while a persist is in flight", () => {
    expect(shouldWarnOnUnload("saving")).toBe(true);
    expect(shouldWarnOnUnload("idle")).toBe(false);
    expect(shouldWarnOnUnload("saved")).toBe(false);
  });
});
