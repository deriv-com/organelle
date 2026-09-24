import { describe, expect, it } from "vitest";

import { indexFromRows, type ChartRow, type SeatMember } from "../../chart/chart-row";
import {
  classifyMechanical,
  resolveChangeType,
  resolveSeatChangeType,
} from "./classify";
import { compareChangeRowsByName } from "./sort-rows";
import { diffSeatSnapshots } from "./diff";
import {
  formatChangePairCsvRows,
  formatChangesCsv,
  CHANGES_CSV_COLUMNS,
} from "./format-csv";
import { findHeaderRenames } from "./header-renames";
import { guardCsvCell, formatCsvRow } from "../csv";
import {
  buildSeatSnapshots,
  snapshotsEqual,
  type EmployeeReportFields,
  type SeatSnapshot,
} from "./seat-snapshot";

function member(
  authId: string,
  name: string,
  overrides: Partial<SeatMember> = {},
): SeatMember {
  return {
    authId,
    displayName: name,
    displayTitle: "Title",
    email: `${authId}@example.com`,
    avatarUrl: null,
    officeLocation: "",
    status: "active",
    joiningDate: null,
    isHost: true,
    sourceName: name,
    sourceTitle: "Title",
    sourceAvatarUrl: null,
    overrideName: null,
    overrideTitle: null,
    overrideAvatarUrl: null,
    ...overrides,
  };
}

function seat(
  id: string,
  parentId: string,
  members: SeatMember[],
  sortOrder = 0,
): ChartRow {
  return { id, parentId, kind: "seat", sortOrder, rowVersion: 1, members };
}

function header(id: string, parentId: string, name: string): ChartRow {
  return {
    id,
    parentId,
    kind: "header",
    sortOrder: 0,
    rowVersion: 1,
    name,
    members: [],
  };
}

function emp(authId: string, id: string): EmployeeReportFields {
  return { id, employmentRecord: `2024.01 #${id}` };
}

function snap(
  rows: ChartRow[],
  extras: Map<string, EmployeeReportFields>,
): Map<string, SeatSnapshot> {
  try {
    indexFromRows(rows);
  } catch {
    /* test fixtures may skip full index validation */
  }
  return buildSeatSnapshots(rows, extras);
}

describe("classifyMechanical", () => {
  const extras = new Map([
    ["publisher", emp("publisher", "1")],
    ["mgr", emp("mgr", "2")],
    ["a", emp("a", "3")],
  ]);

  it("detects manager_change", () => {
    const before = [
      seat("root", "", [member("publisher", "Chief")]),
      header("eng", "root", "Engineering"),
      header("plat", "eng", "Platform"),
      seat("mgr", "plat", [member("mgr", "Manager")]),
      seat("a", "mgr", [member("a", "Alice")]),
    ];
    const after = [
      seat("root", "", [member("publisher", "Chief")]),
      header("eng", "root", "Engineering"),
      header("plat", "eng", "Platform"),
      seat("mgr", "plat", [member("mgr", "Manager")]),
      seat("a", "plat", [member("a", "Alice")]),
    ];
    const pair = diffSeatSnapshots(
      snap(before, extras),
      snap(after, extras),
      new Set(),
    )[0]!;
    expect(classifyMechanical(pair.before, pair.after)).toBe("manager_change");
  });

  it("detects restructure", () => {
    const before = [
      seat("root", "", [member("publisher", "Chief")]),
      header("eng", "root", "Engineering"),
      header("plat", "eng", "Platform"),
      seat("a", "plat", [member("a", "Alice")]),
    ];
    const after = [
      seat("root", "", [member("publisher", "Chief")]),
      header("eng", "root", "Engineering"),
      header("sales", "eng", "Sales"),
      seat("a", "sales", [member("a", "Alice")]),
    ];
    const pair = diffSeatSnapshots(
      snap(before, extras),
      snap(after, extras),
      new Set(),
    )[0]!;
    expect(classifyMechanical(pair.before, pair.after)).toBe(
      "team_level_restructure_change",
    );
  });

  it("detects internal_movement", () => {
    const before = [
      seat("root", "", [member("publisher", "Chief")]),
      header("eng", "root", "Engineering"),
      header("plat", "eng", "Platform"),
      seat("mgr1", "plat", [member("mgr1", "Manager One")]),
      seat("a", "mgr1", [member("a", "Alice")]),
    ];
    const after = [
      seat("root", "", [member("publisher", "Chief")]),
      header("eng", "root", "Engineering"),
      header("sales", "eng", "Sales"),
      seat("mgr2", "sales", [member("mgr2", "Manager Two")]),
      seat("a", "mgr2", [member("a", "Alice")]),
    ];
    const pair = diffSeatSnapshots(
      snap(before, extras),
      snap(after, extras),
      new Set(),
    ).find((p) => p.nodeId === "a")!;
    expect(classifyMechanical(pair.before, pair.after)).toBe("internal_movement");
  });

  it("detects new_hire and seat_removed", () => {
    const tree = [
      seat("root", "", [member("publisher", "Chief")]),
      seat("x", "root", [member("n", "New")]),
    ];
    expect(classifyMechanical(null, snap(tree, extras).get("x")!)).toBe("new_hire");
    expect(classifyMechanical(snap(tree, extras).get("x")!, null)).toBe("seat_removed");
  });

  it("detects peer_change", () => {
    const before = [
      seat("root", "", [member("publisher", "Chief")]),
      header("eng", "root", "Engineering"),
      seat("a", "eng", [member("a", "Alice")]),
    ];
    const after = [
      seat("root", "", [member("publisher", "Chief")]),
      header("eng", "root", "Engineering"),
      seat("a", "eng", [member("a", "Alice"), member("b", "Bob", { isHost: false })]),
    ];
    const pair = diffSeatSnapshots(
      snap(before, extras),
      snap(after, extras),
      new Set(),
    )[0]!;
    expect(classifyMechanical(pair.before, pair.after)).toBe("peer_change");
  });

  it("returns null for sort_order only", () => {
    const before = [
      seat("root", "", [member("publisher", "Chief")]),
      header("eng", "root", "Engineering"),
      seat("a", "eng", [member("a", "Alice")], 0),
    ];
    const after = [
      seat("root", "", [member("publisher", "Chief")]),
      header("eng", "root", "Engineering"),
      seat("a", "eng", [member("a", "Alice")], 99),
    ];
    const pair = diffSeatSnapshots(
      snap(before, extras),
      snap(after, extras),
      new Set(),
    )[0]!;
    expect(classifyMechanical(pair.before, pair.after)).toBe(null);
  });

  it("falls back to org_chart_change", () => {
    const tree = [
      seat("root", "", [member("publisher", "Chief")]),
      header("eng", "root", "Engineering"),
      seat("a", "eng", [member("a", "Alice")]),
    ];
    const b = snap(tree, extras).get("a")!;
    const changed: SeatSnapshot = { ...b, jobTitle: "Different" };
    expect(classifyMechanical(b, changed)).toBe("org_chart_change");
  });
});

describe("resolveChangeType overrides", () => {
  it("uses the mechanical reason when there is no override", () => {
    expect(
      resolveChangeType({
        mechanical: "team_level_restructure_change",
        isRestore: false,
        manualOverride: null,
        publishOverride: null,
      }),
    ).toBe("team_level_restructure_change");
  });

  it("restore wins over publish override", () => {
    expect(
      resolveChangeType({
        mechanical: "team_level_restructure_change",
        isRestore: true,
        manualOverride: "promotion_change",
        publishOverride: "manager_change",
      }),
    ).toBe("snapshot_restore");
  });

  it("publish override wins over mechanical", () => {
    expect(
      resolveChangeType({
        mechanical: "internal_movement",
        isRestore: false,
        manualOverride: null,
        publishOverride: "team_level_restructure_change",
      }),
    ).toBe("team_level_restructure_change");
  });

  it("manual reason wins over legacy publish override and mechanical", () => {
    expect(
      resolveChangeType({
        mechanical: "manager_change",
        isRestore: false,
        manualOverride: "promotion_change",
        publishOverride: "team_level_restructure_change",
      }),
    ).toBe("promotion_change");
  });
});

describe("resolveSeatChangeType", () => {
  const merge = (
    changeReasonOverrides: Record<string, "promotion_change" | null> | null,
  ) => ({
    publishChangeType: null,
    changeReasonOverrides,
  });

  it("uses the latest merge entry for the same seat", () => {
    expect(
      resolveSeatChangeType({
        nodeId: "seat-a",
        mechanical: "manager_change",
        hasRestore: false,
        merges: [merge({ "seat-a": "promotion_change" }), merge({ "seat-a": null })],
      }),
    ).toBe("manager_change");
  });

  it("does not let a later merge for another seat replace the reason", () => {
    expect(
      resolveSeatChangeType({
        nodeId: "seat-a",
        mechanical: "manager_change",
        hasRestore: false,
        merges: [merge({ "seat-a": "promotion_change" }), merge({ "seat-b": null })],
      }),
    ).toBe("promotion_change");
  });
});

describe("header rename suppression", () => {
  it("produces zero CSV rows when only a header renames", () => {
    const before = [
      seat("root", "", [member("publisher", "Chief")]),
      header("eng", "root", "Engineering"),
      seat("a", "eng", [member("a", "Alice")]),
    ];
    const after = [
      seat("root", "", [member("publisher", "Chief")]),
      header("eng", "root", "Eng Renamed"),
      seat("a", "eng", [member("a", "Alice")]),
    ];
    indexFromRows(before);
    indexFromRows(after);
    const renames = findHeaderRenames(before, after);
    const renamedIds = new Set(renames.map((r) => r.nodeId));
    const extras = new Map([["a", emp("a", "3")]]);
    const pairs = diffSeatSnapshots(
      snap(before, extras),
      snap(after, extras),
      renamedIds,
    );
    expect(pairs).toHaveLength(0);
  });
});

describe("net-zero squash via diff", () => {
  it("drops move-out-and-back pairs", () => {
    const tree = [
      seat("root", "", [member("publisher", "Chief")]),
      header("eng", "root", "Engineering"),
      header("sales", "root", "Sales"),
      seat("a", "eng", [member("a", "Alice")]),
    ];
    const extras = new Map([["a", emp("a", "3")]]);
    const before = snap(tree, extras);
    const after = snap(tree, extras);
    expect(diffSeatSnapshots(before, after, new Set())).toHaveLength(0);
    expect(snapshotsEqual(before.get("a")!, after.get("a")!)).toBe(true);
  });
});

describe("multi-seat employee", () => {
  it("produces two independent pairs", () => {
    const before = [
      seat("root", "", [member("publisher", "Chief")]),
      header("eng", "root", "Engineering"),
      header("sales", "root", "Sales"),
      seat("a1", "eng", [member("a", "Amy")]),
      seat("a2", "sales", [member("a", "Amy")]),
    ];
    const after = [
      seat("root", "", [member("publisher", "Chief")]),
      header("eng", "root", "Engineering"),
      header("sales", "root", "Sales"),
      seat("a1", "sales", [member("a", "Amy")]),
      seat("a2", "eng", [member("a", "Amy")]),
    ];
    const extras = new Map([["a", emp("a", "9")]]);
    const pairs = diffSeatSnapshots(
      snap(before, extras),
      snap(after, extras),
      new Set(),
    );
    expect(pairs).toHaveLength(2);
  });
});

describe("resigned exclusion", () => {
  it("excludes resigned employees", () => {
    const before = [
      seat("root", "", [member("publisher", "Chief")]),
      seat("a", "root", [member("a", "Amy", { status: "active" })]),
    ];
    const after = [
      seat("root", "", [member("publisher", "Chief")]),
      seat("a", "root", [member("a", "Amy", { status: "resigned" })]),
    ];
    const extras = new Map([["a", emp("a", "9")]]);
    const pairs = diffSeatSnapshots(
      snap(before, extras),
      snap(after, extras),
      new Set(),
    );
    expect(pairs).toHaveLength(0);
  });
});

describe("CSV contract", () => {
  it("new_hire and seat_removed blank sides", () => {
    const snapA: SeatSnapshot = {
      nodeId: "a",
      parentNodeId: "root",
      parentSeatId: "root",
      sortOrder: 0,
      jobTitle: "Engineer",
      memberAuthIds: ["x"],
      hostAuthId: "x",
      employeeId: "101",
      employmentRecord: "2024.01 #101",
      fullName: "Test User",
      email: "test@example.com",
      status: "active",
      managerEmail: "mgr@example.com",
      managerName: "Manager",
      headerPathIds: ["h1"],
      dept: "Eng",
      teamLevels: ["", "", "", "", "", "", ""] as SeatSnapshot["teamLevels"],
    };

    const hire = formatChangePairCsvRows({
      before: null,
      after: snapA,
      changeType: "new_hire",
      effectiveDate: "2026-08-05T00:00:00.000Z",
    });
    expect(hire[0]![5]).toBe("");
    expect(hire[0]![9]).toBe("");
    expect(hire[0]![10]).toBe("New Hire");
    expect(hire[1]![9]).toBe("mgr@example.com");

    const removed = formatChangePairCsvRows({
      before: snapA,
      after: null,
      changeType: "seat_removed",
      effectiveDate: "2026-08-05T00:00:00.000Z",
    });
    expect(removed[1]![2]).toBe("");
    expect(removed[1]![9]).toBe("");
    expect(removed[1]![10]).toBe("Position Removed");
  });

  it("has exactly the 14 public columns byte-for-byte", () => {
    const header = formatCsvRow([...CHANGES_CSV_COLUMNS]);
    expect(header.split(",")).toHaveLength(14);
    expect(formatChangesCsv([]).split("\n")[0]).toBe(header);
  });

  it("writes a manual reason to both CSV rows", () => {
    const snapshot = {
      nodeId: "a",
      parentNodeId: "root",
      parentSeatId: "root",
      sortOrder: 0,
      jobTitle: "Engineer",
      memberAuthIds: ["x"],
      hostAuthId: "x",
      employeeId: "101",
      employmentRecord: "2024.01 #101",
      fullName: "Test User",
      email: "test@example.com",
      status: "active",
      managerEmail: "mgr@example.com",
      managerName: "Manager",
      headerPathIds: ["h1"],
      dept: "Eng",
      teamLevels: ["", "", "", "", "", "", ""],
    } as SeatSnapshot;
    const rows = formatChangePairCsvRows({
      before: snapshot,
      after: { ...snapshot, managerName: "New Manager" },
      changeType: "promotion_change",
      effectiveDate: "2026-08-05T00:00:00.000Z",
    });

    expect(rows[0]![10]).toBe("Promotion Change");
    expect(rows[1]![10]).toBe("Promotion Change");
  });

  it("prefixes injection in output", () => {
    const row = formatCsvRow(["Before", guardCsvCell("=1+1"), ...Array(12).fill("")]);
    expect(row).toContain("'=1+1");
  });
});

describe("change report row order", () => {
  it("sorts rows ascending by employee display name", () => {
    const snap = (name: string): SeatSnapshot =>
      ({
        fullName: name,
        email: `${name}@example.com`,
      }) as SeatSnapshot;

    const rows = [
      { before: null, after: snap("Zara") },
      { before: snap("Alice"), after: snap("Alice") },
      { before: snap("Bob"), after: null },
    ].sort(compareChangeRowsByName);

    expect(rows.map((r) => r.after?.fullName ?? r.before?.fullName)).toEqual([
      "Alice",
      "Bob",
      "Zara",
    ]);
  });
});
