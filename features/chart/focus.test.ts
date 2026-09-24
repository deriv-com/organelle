import { describe, expect, it } from "vitest";

import type { ChartRow } from "./chart-row";
import { countExpanded, MAX_EXPANDED_NODES, PAGE_SIZE } from "./collapse";
import { applyFocusExpansion, clearCentered } from "./focus";

function row(id: string, parentId: string): ChartRow {
  return {
    id,
    parentId,
    kind: "seat",
    sortOrder: 0,
    rowVersion: 1,
    members: [],
    _expanded: true,
  };
}

describe("applyFocusExpansion", () => {
  // root → a → b → target; root → other → otherChild
  const rows = () => [
    row("root", ""),
    row("a", "root"),
    row("b", "a"),
    row("target", "b"),
    row("other", "root"),
    row("otherChild", "other"),
  ];

  it("expands the target and every ancestor, collapsing everything else", () => {
    const r = rows();
    expect(applyFocusExpansion(r, "target")).not.toBeNull();
    const expanded = Object.fromEntries(r.map((x) => [x.id, x._expanded]));
    expect(expanded).toEqual({
      root: true,
      a: true,
      b: true,
      target: true,
      other: false,
      otherChild: false,
    });
  });

  it("pages the parent so a 31st+ child is not behind the pager", () => {
    const parent = row("p", "root");
    const kids = Array.from({ length: PAGE_SIZE + 2 }, (_, i) => {
      const child = row(`c${i}`, "p");
      child.sortOrder = i;
      return child;
    });
    const r = [row("root", ""), parent, ...kids];
    const targetId = `c${PAGE_SIZE + 1}`;
    expect(applyFocusExpansion(r, targetId)).not.toBeNull();
    expect(parent._pagingStep).toBe(Math.ceil((PAGE_SIZE + 2) / PAGE_SIZE) * PAGE_SIZE);
    expect(r.find((x) => x.id === targetId)?._expanded).toBe(true);
  });

  it("does not page a parent whose target is on the first page", () => {
    const r = rows();
    expect(applyFocusExpansion(r, "target")).not.toBeNull();
    expect(r.find((x) => x.id === "b")?._pagingStep).toBeUndefined();
  });

  it("returns null for an unknown node and touches nothing", () => {
    const r = rows();
    expect(applyFocusExpansion(r, "nope")).toBeNull();
    expect(r.every((x) => x._expanded === true)).toBe(true);
  });

  it("preserveExpanded keeps already-open teams and still opens the ancestor path", () => {
    const r = rows();
    r.find((x) => x.id === "a")!._expanded = false;
    r.find((x) => x.id === "b")!._expanded = false;
    r.find((x) => x.id === "target")!._expanded = false;
    expect(applyFocusExpansion(r, "target", { preserveExpanded: true })).not.toBeNull();
    expect(Object.fromEntries(r.map((x) => [x.id, x._expanded]))).toEqual({
      root: true,
      a: true,
      b: true,
      target: true,
      other: true,
      otherChild: true,
    });
  });

  it("preserveExpanded does not open teams that were already collapsed", () => {
    const r = rows();
    r.find((x) => x.id === "other")!._expanded = false;
    r.find((x) => x.id === "otherChild")!._expanded = false;
    expect(applyFocusExpansion(r, "target", { preserveExpanded: true })).not.toBeNull();
    expect(r.find((x) => x.id === "other")?._expanded).toBe(false);
    expect(r.find((x) => x.id === "otherChild")?._expanded).toBe(false);
    expect(r.find((x) => x.id === "target")?._expanded).toBe(true);
  });

  it("preserveExpanded still pages a 31st+ sibling", () => {
    const parent = row("p", "root");
    const kids = Array.from({ length: PAGE_SIZE + 2 }, (_, i) => {
      const child = row(`c${i}`, "p");
      child.sortOrder = i;
      return child;
    });
    const r = [row("root", ""), parent, ...kids];
    const targetId = `c${PAGE_SIZE + 1}`;
    expect(applyFocusExpansion(r, targetId, { preserveExpanded: true })).not.toBeNull();
    expect(parent._pagingStep).toBe(Math.ceil((PAGE_SIZE + 2) / PAGE_SIZE) * PAGE_SIZE);
    expect(r.find((x) => x.id === "c0")?._expanded).toBe(true);
  });

  it("preserveExpanded falls back to isolating the ancestor path when the union would exceed the budget", () => {
    const parent = row("p", "root");
    const extras = Array.from({ length: MAX_EXPANDED_NODES }, (_, i) => {
      const extra = row(`e${i}`, "root");
      extra._expanded = true;
      extra.sortOrder = i;
      return extra;
    });
    const r = [row("root", ""), parent, row("target", "p"), ...extras];
    r.find((x) => x.id === "root")!._expanded = true;
    parent._expanded = false;
    r.find((x) => x.id === "target")!._expanded = false;
    const outcome = applyFocusExpansion(r, "target", { preserveExpanded: true });
    expect(outcome).not.toBeNull();
    expect(outcome!.limited).toBe(true);
    expect(countExpanded(r)).toBeLessThanOrEqual(MAX_EXPANDED_NODES);
    expect(r.find((x) => x.id === "target")?._expanded).toBe(true);
    expect(r.find((x) => x.id === "e0")?._expanded).toBe(false);
  });

  it("preserveExpanded returns null for an unknown node and touches nothing", () => {
    const r = rows();
    r.find((x) => x.id === "other")!._expanded = false;
    expect(applyFocusExpansion(r, "nope", { preserveExpanded: true })).toBeNull();
    expect(r.find((x) => x.id === "other")?._expanded).toBe(false);
    expect(r.find((x) => x.id === "target")?._expanded).toBe(true);
  });

  it("clears _centered on every row (one-shot after a focused render)", () => {
    const r = rows();
    r[3]!._centered = true;
    r[0]!._centered = true;
    clearCentered(r);
    expect(r.every((x) => x._centered !== true)).toBe(true);
  });
});
