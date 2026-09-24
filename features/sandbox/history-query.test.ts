import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("sandbox history query", () => {
  it("does not truncate the activity feed", () => {
    const source = readFileSync(new URL("./actions/undo.ts", import.meta.url), "utf8");
    const historyQuery = source.slice(
      source.indexOf("export async function getSandboxHistory"),
    );

    expect(historyQuery).not.toMatch(/\blimit\s+500\b/i);
  });
});
