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
