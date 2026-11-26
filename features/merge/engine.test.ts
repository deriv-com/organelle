import { describe, expect, it } from "vitest";

import { runMerge } from "./engine";
import type { MergeAssignment, MergeNode } from "./types";
import { validateGraph } from "./validate";

function assignment(
  id: string,
  name: string,
  extra: Partial<MergeAssignment> = {},
): MergeAssignment {
  return {
    employeeAuthId: id,
    isHost: true,
    displayName: name,
    displayTitle: "",
    email: "",
    avatarUrl: null,
    officeLocation: "",
    status: "active",
    joiningDate: null,
    ...extra,
  };
}

function header(
  id: string,
  parentId: string,
  name: string,
  extra: Partial<MergeNode> = {},
): MergeNode {
  return {
    id,
    parentId,
    kind: "header",
    sortOrder: extra.sortOrder ?? 0,
    rowVersion: extra.rowVersion ?? 1,
    name,
    jobTitle: null,
    positionLevel: null,
    isAssistant: false,
    leafGridColumns: extra.leafGridColumns ?? 3,
    assignments: [],
    ...extra,
  };
}

function seat(
  id: string,
  parentId: string,
  name: string,
  extra: Partial<MergeNode> = {},
): MergeNode {
  return {
    id,
    parentId,
    kind: "seat",
    sortOrder: extra.sortOrder ?? 0,
    rowVersion: extra.rowVersion ?? 1,
    name: null,
    jobTitle: extra.jobTitle ?? "Role",
    positionLevel: null,
    isAssistant: extra.isAssistant ?? false,
    leafGridColumns: extra.leafGridColumns ?? 3,
    assignments: extra.assignments ?? [assignment(id, name)],
    ...extra,
  };
}

const root = header("root", "", "Publisher");
const finance = header("fin", "root", "Finance");
const legal = header("legal", "root", "Legal");

function baseTree(): MergeNode[] {
  return [root, finance, legal, seat("riley", "root", "Riley Fixture")];
}

describe("runMerge three-way diff", () => {
  it("zero-drift publishes the sandbox tree and reports no conflicts", () => {
    const base = baseTree();
    const sandbox = [
      root,
      finance,
      legal,
      seat("riley", "fin", "Riley Fixture"),
      header("new", "root", "New team"),
    ];
    const result = runMerge({
      base,
      live: base,
      sandbox,
      liveSeq: 3,
      forkedFromSeq: 3,
    });
    expect(result.zeroDrift).toBe(true);
    expect(result.conflicts).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.merged.map((n) => n.id).sort()).toEqual(
      sandbox.map((n) => n.id).sort(),
    );
    expect(result.merged.find((n) => n.id === "riley")?.parentId).toBe("fin");
    expect(result.snapshot.nodes.map((n) => n.node_id).sort()).toEqual(
      sandbox.map((n) => n.id).sort(),
    );
  });

  it("auto-applies sandbox-only changes and keeps live-only changes", () => {
    const base = baseTree();
    const live = [...baseTree(), header("ops", "root", "Ops")];
    const sandbox = [root, finance, legal, seat("riley", "fin", "Riley Fixture")];
    const result = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
    });
    expect(result.conflicts).toEqual([]);
    expect(result.merged.find((n) => n.id === "riley")?.parentId).toBe("fin");
    expect(result.merged.find((n) => n.id === "ops")?.name).toBe("Ops");
    expect(result.changes.some((c) => c.key === "move:riley")).toBe(true);
  });

  it("both-same result auto-applies and sort_order never conflicts", () => {
    const base = baseTree();
    const live = [
      root,
      { ...finance, sortOrder: 5 },
      legal,
      seat("riley", "root", "Riley"),
    ];
    const sandbox = [
      root,
      { ...finance, sortOrder: 9 },
      legal,
      seat("riley", "root", "Riley"),
    ];
    const result = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
    });
    expect(result.conflicts.filter((c) => c.field === "sort_order")).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.merged.find((n) => n.id === "fin")?.sortOrder).toBe(9);
  });

  it("does not conflict when the same employee sits on different seats (multi-role)", () => {
    const alex = assignment("alex", "Alex");
    const base = [
      root,
      seat("a", "root", "A", { assignments: [alex] }),
      seat("b", "root", "B", { assignments: [] }),
    ];
    const live = [
      root,
      seat("a", "root", "A", { assignments: [] }),
      seat("b", "root", "B", { assignments: [{ ...alex, isHost: true }] }),
    ];
    const sandbox = [
      root,
      seat("a", "root", "A", { assignments: [alex] }),
      seat("b", "root", "B", { assignments: [] }),
    ];
    const result = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
    });
    expect(result.conflicts).toEqual([]);
    const a = result.merged.find((n) => n.id === "a");
    const b = result.merged.find((n) => n.id === "b");
    expect(a?.assignments.some((x) => x.employeeAuthId === "alex")).toBe(true);
    expect(b?.assignments.some((x) => x.employeeAuthId === "alex")).toBe(true);
  });
});

describe("conflict kinds", () => {
  it("concurrent_move offers use_live / use_sandbox / drop", () => {
    const base = baseTree();
    const live = [root, finance, legal, seat("riley", "legal", "Riley Fixture")];
    const sandbox = [root, finance, legal, seat("riley", "fin", "Riley Fixture")];
    const result = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
    });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.kind).toBe("concurrent_move");
    expect(result.conflicts[0]!.allowed).toEqual(["use_live", "use_sandbox", "drop"]);
    expect(result.valid).toBe(false);
    expect(result.merged.find((n) => n.id === "riley")?.parentId).toBe("fin");
    expect(result.tints.moved).toContain("riley");

    const mine = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
      resolutions: { [result.conflicts[0]!.key]: { choice: "use_sandbox" } },
    });
    expect(mine.merged.find((n) => n.id === "riley")?.parentId).toBe("fin");
    expect(mine.valid).toBe(true);

    const keep = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
      resolutions: { [result.conflicts[0]!.key]: { choice: "use_live" } },
    });
    expect(keep.merged.find((n) => n.id === "riley")?.parentId).toBe("legal");
  });

  it("stale_target when the sandbox parent was deleted in live", () => {
    const base = baseTree();
    const live = [root, legal, seat("riley", "root", "Riley Fixture")];
    const sandbox = [root, finance, legal, seat("riley", "fin", "Riley Fixture")];
    const result = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
    });
    const target = result.conflicts.find((c) => c.kind === "stale_target");
    expect(target).toBeDefined();
    expect(target!.allowed).toEqual(["pick_new_target", "drop"]);
    const moved = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
      resolutions: {
        "stale_source:fin:exists": { choice: "drop" },
        [target!.key]: {
          choice: "pick_new_target",
          newParentId: "legal",
        },
      },
    });
    expect(moved.merged.find((n) => n.id === "riley")?.parentId).toBe("legal");
    expect(moved.valid).toBe(true);
  });

  it("stale_target when the live parent seat's only member resigned", () => {
    const manager = seat("mgr", "root", "Pat", {
      assignments: [assignment("pat", "Pat", { status: "resigned" })],
    });
    const base = [root, manager, seat("riley", "root", "Riley")];
    const live = [root, manager, seat("riley", "root", "Riley")];
    const sandbox = [root, manager, seat("riley", "mgr", "Riley")];
    const result = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
    });
    expect(result.conflicts[0]!.kind).toBe("stale_target");
  });

  it("stale_source when live deleted a node the sandbox still has", () => {
    const base = baseTree();
    const live = [root, finance, legal];
    const sandbox = [root, finance, legal, seat("riley", "fin", "Riley Fixture")];
    const result = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
    });
    expect(result.conflicts[0]!.kind).toBe("stale_source");
    expect(result.conflicts[0]!.allowed).toEqual(["recreate", "drop"]);
    const putBack = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
      resolutions: { [result.conflicts[0]!.key]: { choice: "recreate" } },
    });
    expect(putBack.merged.some((n) => n.id === "riley")).toBe(true);
    const skip = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
      resolutions: { [result.conflicts[0]!.key]: { choice: "drop" } },
    });
    expect(skip.merged.some((n) => n.id === "riley")).toBe(false);
    expect(skip.unresolved).toEqual([]);
    expect(skip.valid).toBe(true);
  });

  it("concurrent_edit on header name", () => {
    const base = baseTree();
    const live = [
      root,
      header("fin", "root", "Finance Live"),
      legal,
      seat("riley", "root", "J"),
    ];
    const sandbox = [
      root,
      header("fin", "root", "Finance SB"),
      legal,
      seat("riley", "root", "J"),
    ];
    const result = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
    });
    expect(result.conflicts[0]!.kind).toBe("concurrent_edit");
    expect(result.conflicts[0]!.allowed).toEqual(["use_live", "use_sandbox", "drop"]);
  });

  it("concurrent_edit on overrides from in-memory triples", () => {
    const base = baseTree();
    const result = runMerge({
      base,
      live: base,
      sandbox: base,
      liveSeq: 4,
      forkedFromSeq: 3,
      baseOverrides: { e1: { displayName: "A", displayTitle: null, avatarUrl: null } },
      liveOverrides: { e1: { displayName: "B", displayTitle: null, avatarUrl: null } },
      sandboxOverrides: {
        e1: { displayName: "C", displayTitle: null, avatarUrl: null },
      },
    });
    expect(result.conflicts[0]!.kind).toBe("concurrent_edit");
    expect(result.conflicts[0]!.field).toBe("override");
  });

  it("counts sandbox employee detail overrides as merge edits", () => {
    const base = baseTree();
    const result = runMerge({
      base,
      live: base,
      sandbox: base,
      liveSeq: 4,
      forkedFromSeq: 3,
      baseOverrides: {},
      liveOverrides: {},
      sandboxOverrides: {
        e1: {
          nodeId: "riley",
          updatedBy: "actor-1",
          updatedAt: "2026-09-22T08:54:00.000Z",
          displayName: "Ada Lovelace",
          displayTitle: "Engineer",
          avatarUrl: null,
          officeLocation: "Dubai",
          status: "active",
          joiningDate: null,
        },
      },
      liveEmployeeDetails: {
        e1: {
          nodeId: "riley",
          displayName: "Ada Byron",
          displayTitle: "Engineer",
          avatarUrl: null,
          officeLocation: "London",
          status: "active",
          joiningDate: null,
        },
        "actor-1": {
          displayName: "Editor Person",
          displayTitle: null,
          avatarUrl: null,
        },
      },
    });

    expect(result.changes.find((change) => change.key === "employee:e1")).toMatchObject(
      {
        nodeId: "riley",
        fieldChanges: [
          { field: "displayName", before: "Ada Byron", after: "Ada Lovelace" },
          { field: "officeLocation", before: "London", after: "Dubai" },
        ],
        employee: {
          name: "Ada Lovelace",
          actorName: "Editor Person",
          updatedAt: "2026-09-22T08:54:00.000Z",
        },
      },
    );
    expect(result.counts.edits).toBe(1);
    expect(result.tints.edited).toContain("riley");
    expect(result.snapshot.employeeOverrides).toMatchObject([
      {
        auth_id: "e1",
        node_id: "riley",
        display_name: "Ada Lovelace",
      },
    ]);
  });

  it("compares an unplaced global employee against published employee details", () => {
    const base = baseTree();
    const sandbox = [
      ...base,
      seat("new-seat", "fin", "Global Employee", {
        assignments: [assignment("global-employee", "Global Employee")],
      }),
    ];
    const result = runMerge({
      base,
      live: base,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
      baseOverrides: {},
      liveOverrides: {},
      sandboxOverrides: {
        "global-employee": {
          nodeId: "new-seat",
          displayName: "Global Employee",
          displayTitle: "Engineer",
          avatarUrl: null,
          officeLocation: "Dubai",
          status: "active",
        },
      },
      liveEmployeeDetails: {
        "global-employee": {
          displayName: "Global Employee",
          displayTitle: "Engineer",
          avatarUrl: null,
          officeLocation: "Kuala Lumpur",
          status: "active",
        },
      },
    });

    expect(
      result.changes.find((change) => change.key === "employee:global-employee")
        ?.fieldChanges,
    ).toEqual([
      {
        field: "officeLocation",
        label: "Office location",
        before: "Kuala Lumpur",
        after: "Dubai",
      },
    ]);
  });

  it("keeps Blank as the published baseline for sandbox-only draft employees", () => {
    const base = baseTree();
    const result = runMerge({
      base,
      live: base,
      sandbox: [
        ...base,
        seat("draft-seat", "fin", "Draft Employee", {
          assignments: [assignment("draft-employee", "Draft Employee")],
        }),
      ],
      liveSeq: 4,
      forkedFromSeq: 3,
      baseOverrides: {},
      liveOverrides: {},
      sandboxOverrides: {
        "draft-employee": {
          nodeId: "draft-seat",
          displayName: "Draft Employee",
          displayTitle: "Analyst",
          avatarUrl: null,
        },
      },
      liveEmployeeDetails: {},
    });

    expect(
      result.changes
        .find((change) => change.key === "employee:draft-employee")
        ?.fieldChanges?.find((field) => field.field === "displayName"),
    ).toEqual({
      field: "displayName",
      label: "Full name",
      before: null,
      after: "Draft Employee",
    });
  });

  it("promotes an effective no-op override without showing a phantom edit", () => {
    const base = baseTree();
    const employee = {
      nodeId: "riley",
      displayName: "Riley Fixture",
      displayTitle: "Engineer",
      avatarUrl: null,
      email: "riley@example.com",
      officeLocation: "London",
      status: "active" as const,
      joiningDate: null,
    };
    const result = runMerge({
      base,
      live: base,
      sandbox: base,
      liveSeq: 4,
      forkedFromSeq: 3,
      baseOverrides: {},
      liveOverrides: {},
      sandboxOverrides: { e1: employee },
      liveEmployeeDetails: { e1: employee },
    });

    expect(result.changes.some((change) => change.key === "employee:e1")).toBe(false);
    expect(result.counts.edits).toBe(0);
    expect(result.tints.edited).not.toContain("riley");
    expect(result.snapshot.employeeOverrides).toMatchObject([
      { auth_id: "e1", display_name: "Riley Fixture" },
    ]);
  });
});

describe("included_keys and resolution cache", () => {
  it("omits sandbox-only changes whose keys are not included", () => {
    const base = baseTree();
    const sandbox = [
      root,
      finance,
      legal,
      seat("riley", "fin", "Riley Fixture"),
      header("new", "root", "New team"),
    ];
    const result = runMerge({
      base,
      live: base,
      sandbox,
      liveSeq: 3,
      forkedFromSeq: 3,
      includedKeys: ["move:riley"],
    });
    expect(result.merged.find((n) => n.id === "riley")?.parentId).toBe("fin");
    expect(result.merged.some((n) => n.id === "new")).toBe(false);
    expect(result.changes.some((c) => c.key === "create:new")).toBe(true);
    expect(result.tints.added).not.toContain("new");
    const catalog = runMerge({
      base,
      live: base,
      sandbox,
      liveSeq: 3,
      forkedFromSeq: 3,
    });
    expect(catalog.tints.added).toContain("new");
  });

  it("reapplies a cached resolution by conflictKey after live_moved", () => {
    const base = baseTree();
    const live = [root, finance, legal, seat("riley", "legal", "Riley Fixture")];
    const sandbox = [root, finance, legal, seat("riley", "fin", "Riley Fixture")];
    const first = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
    });
    const key = first.conflicts[0]!.key;
    const cached = { [key]: { choice: "use_sandbox" as const } };
    const second = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 5,
      forkedFromSeq: 3,
      resolutions: cached,
    });
    expect(second.conflicts[0]!.key).toBe(key);
    expect(second.merged.find((n) => n.id === "riley")?.parentId).toBe("fin");
    expect(second.valid).toBe(true);
  });
});

describe("post-merge graph validation", () => {
  it("catches an A↔B swap cycle before any write", () => {
    const base = [root, seat("a", "root", "A"), seat("b", "root", "B")];
    const live = [root, seat("a", "root", "A"), seat("b", "a", "B")];
    const sandbox = [root, seat("a", "b", "A"), seat("b", "root", "B")];
    const mine = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
    });
    expect(mine.graphConflicts[0]!.kind).toBe("combo_cycle");
    expect(mine.valid).toBe(false);
  });

  it("catches a three-node cycle across three resolutions", () => {
    const base = [
      root,
      seat("a", "root", "A"),
      seat("b", "root", "B"),
      seat("c", "root", "C"),
    ];
    const live = [
      root,
      seat("a", "root", "A"),
      seat("b", "a", "B"),
      seat("c", "b", "C"),
    ];
    const sandbox = [
      root,
      seat("a", "c", "A"),
      seat("b", "root", "B"),
      seat("c", "root", "C"),
    ];
    const result = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
    });
    expect(result.valid).toBe(false);
    expect(result.graphConflicts[0]!.kind).toBe("combo_cycle");
  });

  it("catches depth overflow created only by the combination", () => {
    const chain = (ids: string[]): MergeNode[] => {
      const nodes: MergeNode[] = [root];
      let parent = "root";
      for (const id of ids) {
        nodes.push(header(id, parent, id));
        parent = id;
      }
      return nodes;
    };
    // 15 headers under root = depth 16 at the last. Live adds one more at the
    // bottom; sandbox moves the whole chain under an extra wrapper — combo > 16.
    const ids = Array.from({ length: 14 }, (_, i) => `d${i}`);
    const base = chain(ids);
    const live = chain([...ids, "liveExtra"]);
    const sandbox = [
      header("wrap", "root", "Wrap"),
      ...chain(ids).map((n) => (n.id === "d0" ? { ...n, parentId: "wrap" } : n)),
    ];
    // sandbox wrap is sibling of chain? d0 under wrap, wrap under root.
    const result = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
    });
    expect(result.valid).toBe(false);
    expect(result.graphConflicts.some((c) => c.kind === "combo_depth")).toBe(true);
  });

  it("catches an orphan from parent-delete vs child-move", () => {
    const nodes: MergeNode[] = [root, seat("kid", "ghost", "Kid")];
    const conflicts = validateGraph(nodes);
    expect(conflicts[0]!.kind).toBe("combo_orphan");
  });

  it("catches a single-root violation", () => {
    const conflicts = validateGraph([header("r1", "", "One"), header("r2", "", "Two")]);
    expect(conflicts[0]!.kind).toBe("combo_root");
  });
});

describe("leaf grid columns merge", () => {
  it("applies sandbox-only column change with no conflicts", () => {
    const base = [
      root,
      finance,
      header("eng", "root", "Engineering", { leafGridColumns: 3 }),
    ];
    const live = base;
    const sandbox = [
      root,
      finance,
      header("eng", "root", "Engineering", { leafGridColumns: 4 }),
    ];
    const result = runMerge({ base, live, sandbox, liveSeq: 1, forkedFromSeq: 1 });
    expect(result.conflicts).toHaveLength(0);
    expect(result.merged.find((n) => n.id === "eng")!.leafGridColumns).toBe(4);
  });

  it("keeps live-only column change when sandbox did not touch it", () => {
    const base = [
      root,
      finance,
      header("eng", "root", "Engineering", { leafGridColumns: 3 }),
    ];
    const live = [
      root,
      finance,
      header("eng", "root", "Engineering", { leafGridColumns: 5 }),
    ];
    const sandbox = base;
    const result = runMerge({ base, live, sandbox, liveSeq: 2, forkedFromSeq: 1 });
    expect(result.conflicts).toHaveLength(0);
    expect(result.merged.find((n) => n.id === "eng")!.leafGridColumns).toBe(5);
  });

  it("sandbox wins when both sides changed columns differently", () => {
    const base = [
      root,
      finance,
      header("eng", "root", "Engineering", { leafGridColumns: 3 }),
    ];
    const live = [
      root,
      finance,
      header("eng", "root", "Engineering", { leafGridColumns: 5 }),
    ];
    const sandbox = [
      root,
      finance,
      header("eng", "root", "Engineering", { leafGridColumns: 2 }),
    ];
    const result = runMerge({ base, live, sandbox, liveSeq: 2, forkedFromSeq: 1 });
    expect(result.conflicts).toHaveLength(0);
    expect(result.merged.find((n) => n.id === "eng")!.leafGridColumns).toBe(2);
  });
});

describe("runMerge sync target (published → sandbox)", () => {
  it("auto-applies live-only changes and keeps sandbox-only changes", () => {
    const base = baseTree();
    const live = [...baseTree(), header("ops", "root", "Ops")];
    const sandbox = [root, finance, legal, seat("riley", "fin", "Riley Fixture")];
    const result = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
      target: "sandbox",
    });
    expect(result.conflicts).toEqual([]);
    expect(result.merged.find((n) => n.id === "riley")?.parentId).toBe("fin");
    expect(result.merged.find((n) => n.id === "ops")?.name).toBe("Ops");
    expect(result.changes.some((c) => c.key === "create:ops")).toBe(true);
    expect(result.snapshot.direction).toBe("sandbox");
  });

  it("resolves concurrent_move with use_live into sandbox", () => {
    const base = baseTree();
    const live = [root, finance, legal, seat("riley", "legal", "Riley Fixture")];
    const sandbox = [root, finance, legal, seat("riley", "fin", "Riley Fixture")];
    const preview = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
      target: "sandbox",
    });
    const key = preview.conflicts[0]!.key;
    const resolved = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
      target: "sandbox",
      resolutions: { [key]: { choice: "use_live" } },
    });
    expect(resolved.merged.find((n) => n.id === "riley")?.parentId).toBe("legal");
    expect(resolved.valid).toBe(true);
  });

  it("tints sandbox delta not published delta", () => {
    const base = baseTree();
    const live = [...baseTree(), header("ops", "root", "Ops")];
    const sandbox = baseTree();
    const result = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
      target: "sandbox",
    });
    expect(result.tints.added).toContain("ops");
  });
});

describe("employee override snapshots", () => {
  const detail = (name: string, location: string) => ({
    nodeId: "riley",
    displayName: name,
    displayTitle: "Engineer",
    avatarUrl: null,
    officeLocation: location,
    status: "active" as const,
    joiningDate: null,
  });

  it("persists the same conflict side selected by the reviewer", () => {
    const base = baseTree();
    const common = {
      base,
      live: base,
      sandbox: base,
      liveSeq: 4,
      forkedFromSeq: 3,
      baseOverrides: { e1: detail("Base", "Base") },
      liveOverrides: { e1: detail("Live", "Live") },
      sandboxOverrides: { e1: detail("Sandbox", "Sandbox") },
      liveEmployeeDetails: { e1: detail("Live", "Live") },
    };
    const preview = runMerge(common);
    const key = preview.conflicts.find(
      (conflict) => conflict.field === "override",
    )!.key;
    const keepLive = runMerge({
      ...common,
      resolutions: { [key]: { choice: "use_live" as const } },
    });
    const useSandbox = runMerge({
      ...common,
      resolutions: { [key]: { choice: "use_sandbox" as const } },
    });
    expect(keepLive.snapshot.employeeOverrides[0]?.display_name).toBe("Live");
    expect(useSandbox.snapshot.employeeOverrides[0]?.display_name).toBe("Sandbox");
  });

  it("does not persist an excluded sandbox employee edit", () => {
    const base = baseTree();
    const result = runMerge({
      base,
      live: base,
      sandbox: base,
      liveSeq: 3,
      forkedFromSeq: 3,
      baseOverrides: {},
      liveOverrides: {},
      sandboxOverrides: { e1: detail("Sandbox", "Sandbox") },
      liveEmployeeDetails: { e1: detail("Live", "Live") },
      includedKeys: [],
    });
    expect(result.snapshot.employeeOverrides).toEqual([]);
  });
});

describe("runMerge tints", () => {
  it("reports edited tint for rename without reparent", () => {
    const base = baseTree();
    const sandbox = base.map((node) =>
      node.id === "fin" ? { ...node, name: "Finance & Ops" } : node,
    );
    const result = runMerge({
      base,
      live: base,
      sandbox,
      liveSeq: 3,
      forkedFromSeq: 3,
    });
    expect(result.tints.edited).toContain("fin");
    expect(result.tints.moved).not.toContain("fin");
  });

  it("prefers moved over edited when parent changes", () => {
    const base = baseTree();
    const sandbox = [
      root,
      finance,
      legal,
      seat("riley", "fin", "Riley Fixture", { jobTitle: "Lead" }),
    ];
    const result = runMerge({
      base,
      live: base,
      sandbox,
      liveSeq: 3,
      forkedFromSeq: 3,
    });
    expect(result.tints.moved).toContain("riley");
    expect(result.tints.edited).not.toContain("riley");
  });
});

describe("sandbox synchronization integrity", () => {
  it("replaces an unchanged occupant and preserves their new primary seat", () => {
    const oldMember = assignment("person-a", "Person A", { isPrimary: true });
    const newMember = assignment("person-b", "Person B", { isPrimary: true });
    const original = seat("original", "root", "Original", { assignments: [oldMember] });
    const other = seat("other", "root", "Other", { assignments: [] });
    const result = runMerge({
      base: [root, original, other],
      sandbox: [root, original, other],
      live: [
        root,
        { ...original, assignments: [newMember] },
        { ...other, assignments: [oldMember] },
      ],
      liveSeq: 4,
      forkedFromSeq: 3,
      target: "sandbox",
    });
    expect(result.valid).toBe(true);
    expect(
      result.merged
        .find((n) => n.id === "original")
        ?.assignments.map((a) => a.employeeAuthId),
    ).toEqual(["person-b"]);
    expect(result.merged.find((n) => n.id === "other")?.assignments).toMatchObject([
      { employeeAuthId: "person-a", isPrimary: true },
    ]);
  });

  it.each([false, true])(
    "requires an explicit decision to restore a deleted live parent (ancestor missing: %s)",
    (missingAncestor) => {
      const division = header("division", "root", "Example Division");
      const team = header("team", "division", "Example Team");
      const member = seat("member", "root", "Example Person");
      const input = {
        base: [root, division, team, member],
        live: [root, division, team, { ...member, parentId: "team" }],
        sandbox: missingAncestor ? [root, member] : [root, division, member],
        liveSeq: 4,
        forkedFromSeq: 3,
        target: "sandbox" as const,
      };
      const preview = runMerge(input);
      const conflict = preview.conflicts.find((c) => c.nodeId === "member");
      expect(conflict).toMatchObject({
        kind: "concurrent_move",
        restoreLiveParentId: "team",
      });
      const stale = runMerge({
        ...input,
        resolutions: { "concurrent_move:member:parent": { choice: "use_live" } },
      });
      expect(stale.unresolved).toContainEqual(conflict);
      const useLive = runMerge({
        ...input,
        resolutions: { [conflict!.key]: { choice: "use_live" } },
      });
      expect(useLive.merged.filter((n) => n.id === "team")).toHaveLength(1);
      expect(useLive.merged.find((n) => n.id === "member")?.parentId).toBe("team");
      expect(useLive.valid).toBe(!missingAncestor);
      if (missingAncestor)
        expect(useLive.graphConflicts).toContainEqual(
          expect.objectContaining({ kind: "combo_orphan" }),
        );
      if (missingAncestor) {
        const orphan = useLive.graphConflicts.find(
          (c) => c.kind === "combo_orphan" && c.nodeId === "team",
        )!;
        expect(orphan.allowed).toContain("pick_new_target");
        const repaired = runMerge({
          ...input,
          resolutions: {
            [conflict!.key]: { choice: "use_live" },
            [orphan.key]: { choice: "pick_new_target", newParentId: "root" },
          },
        });
        expect(repaired.valid).toBe(true);
        expect(repaired.merged.find((n) => n.id === "team")?.parentId).toBe("root");
      }

      const keepSandbox = runMerge({
        ...input,
        resolutions: { [conflict!.key]: { choice: "use_sandbox" } },
      });
      expect(keepSandbox.valid).toBe(true);
      expect(keepSandbox.merged.some((n) => n.id === "team")).toBe(false);
    },
  );
});

describe("primary seat merge", () => {
  function primarySeat(nodes: MergeNode[], employeeAuthId: string): string | null {
    return (
      nodes.find((node) =>
        node.assignments.some(
          (member) => member.employeeAuthId === employeeAuthId && member.isPrimary,
        ),
      )?.id ?? null
    );
  }

  function primaryTree(primaryNodeId: "a" | "b" | "c" = "a"): MergeNode[] {
    const alex = assignment("alex", "Alex");
    return [
      root,
      seat("a", "root", "Role A", {
        jobTitle: "Role A",
        assignments: [{ ...alex, isPrimary: primaryNodeId === "a" }],
      }),
      seat("b", "root", "Role B", {
        jobTitle: "Role B",
        assignments: [{ ...alex, isPrimary: primaryNodeId === "b" }],
      }),
      seat("c", "root", "Role C", {
        jobTitle: "Role C",
        assignments: [{ ...alex, isPrimary: primaryNodeId === "c" }],
      }),
    ];
  }

  it("publishes a zero-drift sandbox primary-seat switch and audits it once", () => {
    const base = primaryTree("a");
    const result = runMerge({
      base,
      live: base,
      sandbox: primaryTree("b"),
      liveSeq: 3,
      forkedFromSeq: 3,
    });

    expect(result.changes.filter((change) => change.key === "primary:alex")).toEqual([
      {
        key: "primary:alex",
        nodeId: "b",
        kind: "edit",
        summary: "Set Alex's primary seat to Role B",
      },
    ]);
    expect(primarySeat(result.merged, "alex")).toBe("b");
    expect(
      result.snapshot.assignments.find(
        (member) => member.employee_auth_id === "alex" && member.is_primary,
      )?.node_id,
    ).toBe("b");
    expect(result.snapshot.logs.filter((log) => log.op === "set_primary_seat")).toEqual(
      [
        {
          op: "set_primary_seat",
          nodeId: "b",
          employeeAuthId: "alex",
          before: { node_id: "a" },
          after: { node_id: "b" },
        },
      ],
    );
    expect(result.tints.edited).toContain("b");
    expect(result.tints.edited).not.toContain("a");
  });

  it("publishes a sandbox-only primary switch after live has advanced", () => {
    const base = primaryTree("a");
    const live = primaryTree("a").map((node) =>
      node.id === "root" ? { ...node, rowVersion: 2 } : node,
    );
    const result = runMerge({
      base,
      live,
      sandbox: primaryTree("b"),
      liveSeq: 4,
      forkedFromSeq: 3,
    });

    expect(result.conflicts).toEqual([]);
    expect(primarySeat(result.merged, "alex")).toBe("b");
  });

  it("preserves a live-only primary switch when the sandbox did not change it", () => {
    const base = primaryTree("a");
    const result = runMerge({
      base,
      live: primaryTree("b"),
      sandbox: base,
      liveSeq: 4,
      forkedFromSeq: 3,
    });

    expect(result.changes.some((change) => change.key === "primary:alex")).toBe(false);
    expect(primarySeat(result.merged, "alex")).toBe("b");
  });

  it("includes or excludes the whole primary switch with one selective key", () => {
    const base = primaryTree("a");
    const sandbox = primaryTree("b");
    const excluded = runMerge({
      base,
      live: base,
      sandbox,
      liveSeq: 3,
      forkedFromSeq: 3,
      includedKeys: [],
    });
    const included = runMerge({
      base,
      live: base,
      sandbox,
      liveSeq: 3,
      forkedFromSeq: 3,
      includedKeys: ["primary:alex"],
    });

    expect(primarySeat(excluded.merged, "alex")).toBe("a");
    expect(primarySeat(included.merged, "alex")).toBe("b");
  });

  it("requires a resolution when live and sandbox select different primaries", () => {
    const base = primaryTree("a");
    const preview = runMerge({
      base,
      live: primaryTree("b"),
      sandbox: primaryTree("c"),
      liveSeq: 4,
      forkedFromSeq: 3,
    });

    expect(preview.valid).toBe(false);
    expect(preview.conflicts).toContainEqual(
      expect.objectContaining({
        key: "concurrent_edit:alex:primary_seat",
        kind: "concurrent_edit",
        field: "primary_seat",
      }),
    );

    const useSandbox = runMerge({
      base,
      live: primaryTree("b"),
      sandbox: primaryTree("c"),
      liveSeq: 4,
      forkedFromSeq: 3,
      resolutions: {
        "concurrent_edit:alex:primary_seat": { choice: "use_sandbox" },
      },
    });
    const useLive = runMerge({
      base,
      live: primaryTree("b"),
      sandbox: primaryTree("c"),
      liveSeq: 4,
      forkedFromSeq: 3,
      resolutions: {
        "concurrent_edit:alex:primary_seat": { choice: "use_live" },
      },
    });

    expect(primarySeat(useSandbox.merged, "alex")).toBe("c");
    expect(primarySeat(useLive.merged, "alex")).toBe("b");
  });

  it("conflicts when the sandbox removes the destination of a live primary switch", () => {
    const base = primaryTree("a");
    const sandbox = primaryTree("a").map((node) =>
      node.id === "b" ? { ...node, assignments: [] } : node,
    );
    const preview = runMerge({
      base,
      live: primaryTree("b"),
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
    });

    expect(preview.valid).toBe(false);
    expect(preview.conflicts).toContainEqual(
      expect.objectContaining({
        key: "concurrent_edit:alex:primary_seat",
        field: "primary_seat",
      }),
    );

    const useLive = runMerge({
      base,
      live: primaryTree("b"),
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
      resolutions: {
        "concurrent_edit:alex:primary_seat": { choice: "use_live" },
      },
    });
    expect(primarySeat(useLive.merged, "alex")).toBe("b");
    expect(
      useLive.merged
        .find((node) => node.id === "b")
        ?.assignments.some((member) => member.employeeAuthId === "alex"),
    ).toBe(true);
  });

  it("restores a deleted primary destination seat when the conflict keeps live", () => {
    const base = primaryTree("a");
    const sandbox = primaryTree("a").filter((node) => node.id !== "b");
    const preview = runMerge({
      base,
      live: primaryTree("b"),
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
    });

    expect(preview.valid).toBe(false);
    expect(
      preview.conflicts.some((conflict) => conflict.field === "primary_seat"),
    ).toBe(true);

    const useLive = runMerge({
      base,
      live: primaryTree("b"),
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
      resolutions: {
        "concurrent_edit:alex:primary_seat": { choice: "use_live" },
      },
    });
    expect(primarySeat(useLive.merged, "alex")).toBe("b");
    expect(useLive.merged.some((node) => node.id === "b")).toBe(true);
  });

  it("conflicts when the sandbox removes every role during a live primary switch", () => {
    const base = primaryTree("a");
    const sandbox = primaryTree("a").map((node) =>
      node.kind === "seat" ? { ...node, assignments: [] } : node,
    );
    const preview = runMerge({
      base,
      live: primaryTree("b"),
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
    });

    expect(preview.valid).toBe(false);
    expect(preview.conflicts).toContainEqual(
      expect.objectContaining({
        key: "concurrent_edit:alex:primary_seat",
        field: "primary_seat",
      }),
    );

    const useLive = runMerge({
      base,
      live: primaryTree("b"),
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
      resolutions: {
        "concurrent_edit:alex:primary_seat": { choice: "use_live" },
      },
    });
    expect(primarySeat(useLive.merged, "alex")).toBe("b");
  });

  it("removes every role when resolving toward a side with no assignments", () => {
    const base = primaryTree("a");
    const live = primaryTree("a").map((node) =>
      node.kind === "seat" ? { ...node, assignments: [] } : node,
    );
    const sandbox = primaryTree("b");
    const preview = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
    });

    expect(preview.valid).toBe(false);
    expect(
      preview.conflicts.some((conflict) => conflict.field === "primary_seat"),
    ).toBe(true);

    const useLive = runMerge({
      base,
      live,
      sandbox,
      liveSeq: 4,
      forkedFromSeq: 3,
      resolutions: {
        "concurrent_edit:alex:primary_seat": { choice: "use_live" },
      },
    });
    expect(primarySeat(useLive.merged, "alex")).toBeNull();
    expect(
      useLive.merged.some((node) =>
        node.assignments.some((member) => member.employeeAuthId === "alex"),
      ),
    ).toBe(false);
  });

  it("does not show a new employee's first assignment as a separate primary switch", () => {
    const base = [root, seat("a", "root", "Role A", { assignments: [] })];
    const sandbox = [
      root,
      seat("a", "root", "Role A", {
        assignments: [assignment("new-person", "New Person", { isPrimary: true })],
      }),
    ];
    const result = runMerge({
      base,
      live: base,
      sandbox,
      liveSeq: 3,
      forkedFromSeq: 3,
    });

    expect(result.changes.some((change) => change.key === "assign:a:new-person")).toBe(
      true,
    );
    expect(result.changes.some((change) => change.key === "primary:new-person")).toBe(
      false,
    );
    expect(primarySeat(result.merged, "new-person")).toBe("a");
  });
});

describe("manager-only review", () => {
  it("includes a reporting manager change even when structure is unchanged", () => {
    const before = {
      displayName: "Example Person",
      displayTitle: "Engineer",
      avatarUrl: null,
      primaryManagerAuthId: "manager-a",
    };
    const result = runMerge({
      base: baseTree(),
      live: baseTree(),
      sandbox: baseTree(),
      liveSeq: 1,
      forkedFromSeq: 1,
      liveEmployeeDetails: { person: before },
      sandboxOverrides: { person: { ...before, primaryManagerAuthId: "manager-b" } },
    });
    expect(
      result.changes.find((change) => change.key === "employee:person")?.fieldChanges ??
        [],
    ).toContainEqual(
      expect.objectContaining({
        field: "primaryManagerAuthId",
        label: "Reporting manager",
        before: "manager-a",
        after: "manager-b",
      }),
    );
  });
});

describe("sandbox membership synchronization", () => {
  it("preserves a sandbox-only member removal when live changes elsewhere", () => {
    const first = assignment("person-a", "Example A");
    const second = assignment("person-b", "Example B", { isHost: false });
    const shared = seat("shared", "root", "Shared", { assignments: [first, second] });
    const result = runMerge({
      base: [root, shared],
      live: [root, shared, header("new", "root", "New team")],
      sandbox: [root, { ...shared, assignments: [first] }],
      liveSeq: 4,
      forkedFromSeq: 3,
      target: "sandbox",
    });
    expect(result.valid).toBe(true);
    expect(
      result.merged
        .find((n) => n.id === "shared")
        ?.assignments.map((a) => a.employeeAuthId),
    ).toEqual(["person-a"]);
  });
  it("preserves a sandbox-only host selection when live changes elsewhere", () => {
    const first = assignment("person-a", "Example A");
    const second = assignment("person-b", "Example B", { isHost: false });
    const shared = seat("shared", "root", "Shared", { assignments: [first, second] });
    const result = runMerge({
      base: [root, shared],
      live: [root, shared, header("new", "root", "New team")],
      sandbox: [
        root,
        {
          ...shared,
          assignments: [
            { ...first, isHost: false },
            { ...second, isHost: true },
          ],
        },
      ],
      liveSeq: 4,
      forkedFromSeq: 3,
      target: "sandbox",
    });
    expect(result.valid).toBe(true);
    expect(
      result.merged.find((n) => n.id === "shared")?.assignments.find((a) => a.isHost)
        ?.employeeAuthId,
    ).toBe("person-b");
  });
});
