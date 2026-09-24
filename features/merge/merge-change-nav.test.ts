import { describe, expect, it } from "vitest";

import { buildMergeChangeNavItems, includeKeyForNavItem } from "./merge-change-nav";
import { formatConflictSide, type MergeResult } from "./types";

describe("formatConflictSide", () => {
  it("describes deleted vs still-exists with parent and title", () => {
    expect(formatConflictSide({ exists: false, parentLabel: null, title: null })).toBe(
      "Deleted",
    );
    expect(
      formatConflictSide({ exists: true, parentLabel: "Finance", title: "Lead" }),
    ).toBe("Still exists · Under Finance · Lead");
  });
});

describe("buildMergeChangeNavItems", () => {
  it("orders removed, moved, edited, then added and sorts labels within a kind", () => {
    const tints: MergeResult["tints"] = {
      added: ["z"],
      removed: ["b"],
      moved: ["m"],
      edited: ["a"],
    };
    const items = buildMergeChangeNavItems(tints, (id) => id.toUpperCase());
    expect(items.map((item) => [item.kind, item.nodeId])).toEqual([
      ["removed", "b"],
      ["moved", "m"],
      ["edited", "a"],
      ["added", "z"],
    ]);
  });

  it("adds employee field changes to the review list and keeps them mandatory", () => {
    const changes: MergeResult["changes"] = [
      {
        key: "employee:e1",
        nodeId: "seat-a",
        kind: "edit",
        summary: "Update Ada Lovelace",
        fieldChanges: [
          {
            field: "officeLocation",
            label: "Office location",
            before: "London",
            after: "Dubai",
          },
        ],
      },
    ];
    const items = buildMergeChangeNavItems(
      { added: [], removed: [], moved: [], edited: ["seat-a"] },
      () => "Ada Lovelace",
      changes,
    );

    expect(items).toMatchObject([
      {
        id: "employee:e1",
        nodeId: "seat-a",
        label: "Update Ada Lovelace",
        fieldChanges: [{ before: "London", after: "Dubai" }],
      },
    ]);
    expect(includeKeyForNavItem(items[0]!, changes)).toBeNull();
  });

  it.each([
    ["assign:seat-a:e2", "assign", "Assign Grace Hopper"],
    ["unassign:seat-a:e2", "unassign", "Unassign Grace Hopper"],
    ["host:seat-a:e2", "peer", "Peer host on Ada Lovelace"],
  ] as const)(
    "keeps %s and employee updates as separate rows on the same seat",
    (assignmentKey, assignmentKind, assignmentSummary) => {
      const changes: MergeResult["changes"] = [
        {
          key: assignmentKey,
          nodeId: "seat-a",
          kind: assignmentKind,
          summary: assignmentSummary,
        },
        {
          key: "employee:e1",
          nodeId: "seat-a",
          kind: "edit",
          summary: "Update Ada Lovelace",
          fieldChanges: [
            {
              field: "displayName",
              label: "Full name",
              before: "Ada Byron",
              after: "Ada Lovelace",
            },
          ],
        },
      ];
      const items = buildMergeChangeNavItems(
        { added: [], removed: [], moved: [], edited: ["seat-a"] },
        () => "Ada Lovelace",
        changes,
      );

      expect(items.map((item) => item.id).sort()).toEqual(
        [assignmentKey, "employee:e1"].sort(),
      );
      const assignmentItem = items.find((item) => item.id === assignmentKey);
      const employeeItem = items.find((item) => item.id === "employee:e1");
      expect(includeKeyForNavItem(assignmentItem!, changes)).toBe(assignmentKey);
      expect(includeKeyForNavItem(employeeItem!, changes)).toBeNull();
    },
  );
});

describe("includeKeyForNavItem", () => {
  const changes: MergeResult["changes"] = [
    { key: "move:a", nodeId: "a", kind: "move", summary: "move a" },
    { key: "create:b", nodeId: "b", kind: "create", summary: "add b" },
    { key: "delete:c", nodeId: "c", kind: "delete", summary: "remove c" },
    { key: "edit:d", nodeId: "d", kind: "edit", summary: "edit d" },
  ];

  it("returns include key when the nav item matches a selectable auto-change", () => {
    expect(
      includeKeyForNavItem(
        { id: "moved:a", nodeId: "a", kind: "moved", label: "A" },
        changes,
      ),
    ).toBe("move:a");
    expect(
      includeKeyForNavItem(
        { id: "added:b", nodeId: "b", kind: "added", label: "B" },
        changes,
      ),
    ).toBe("create:b");
    expect(
      includeKeyForNavItem(
        { id: "removed:c", nodeId: "c", kind: "removed", label: "C" },
        changes,
      ),
    ).toBe("delete:c");
    expect(
      includeKeyForNavItem(
        { id: "edited:d", nodeId: "d", kind: "edited", label: "D" },
        changes,
      ),
    ).toBe("edit:d");
  });

  it("returns null for conflict-only visual diffs not in auto-changes", () => {
    expect(
      includeKeyForNavItem(
        { id: "moved:x", nodeId: "x", kind: "moved", label: "X" },
        changes,
      ),
    ).toBeNull();
  });
});
