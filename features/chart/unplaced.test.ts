import { describe, expect, it } from "vitest";

import type { ChartRow, SeatMember } from "./chart-row";
import { listUnplacedEmployees } from "./unplaced";

function member(authId: string, extra: Partial<SeatMember> = {}): SeatMember {
  return {
    authId,
    displayName: authId,
    displayTitle: "",
    email: "",
    avatarUrl: null,
    officeLocation: "",
    status: "active",
    joiningDate: null,
    isHost: true,
    sourceName: authId,
    sourceTitle: "",
    sourceAvatarUrl: null,
    overrideName: null,
    overrideTitle: null,
    overrideAvatarUrl: null,
    ...extra,
  };
}

function row(
  id: string,
  kind: "header" | "seat",
  extras: Partial<ChartRow> = {},
): ChartRow {
  return {
    id,
    parentId: "",
    kind,
    sortOrder: 0,
    rowVersion: 1,
    members: [],
    ...extras,
  };
}

describe("listUnplacedEmployees", () => {
  it("returns empty when the catalog is empty", () => {
    expect(listUnplacedEmployees([], [row("s1", "seat")])).toEqual([]);
  });

  it("returns empty when everyone placeable is seated", () => {
    const catalog = [member("a"), member("b", { status: "joining" })];
    const rows = [
      row("s1", "seat", { members: [member("a")] }),
      row("s2", "seat", { members: [member("b")] }),
    ];
    expect(listUnplacedEmployees(catalog, rows)).toEqual([]);
  });

  it("lists joining and active people missing from all seats", () => {
    const catalog = [
      member("zara", {
        displayName: "Zara",
        displayTitle: "Analyst",
        status: "joining",
      }),
      member("amy", {
        displayName: "Amy",
        displayTitle: "Engineer",
        status: "active",
      }),
      member("bob", {
        displayName: "Bob",
        displayTitle: "PM",
        status: "active",
      }),
    ];
    const rows = [row("s1", "seat", { members: [member("bob")] })];
    expect(listUnplacedEmployees(catalog, rows)).toEqual([
      { authId: "amy", displayName: "Amy", displayTitle: "Engineer" },
      { authId: "zara", displayName: "Zara", displayTitle: "Analyst" },
    ]);
  });

  it("treats a person as placed if they hold any seat (multi-role)", () => {
    const catalog = [member("multi", { displayName: "Multi", displayTitle: "Lead" })];
    const rows = [
      row("s1", "seat", { members: [member("multi")] }),
      row("s2", "seat", { members: [member("other")] }),
    ];
    expect(listUnplacedEmployees(catalog, rows)).toEqual([]);
  });

  it("surfaces a person again after they disappear from rows", () => {
    const catalog = [member("gone", { displayName: "Gone", displayTitle: "Ops" })];
    expect(
      listUnplacedEmployees(catalog, [
        row("s1", "seat", { members: [member("gone")] }),
      ]),
    ).toEqual([]);
    expect(listUnplacedEmployees(catalog, [row("s1", "seat")])).toEqual([
      { authId: "gone", displayName: "Gone", displayTitle: "Ops" },
    ]);
  });

  it("excludes inactive and resigned even with no seat", () => {
    const catalog = [
      member("left", { status: "inactive", displayName: "Left" }),
      member("quit", { status: "resigned", displayName: "Quit" }),
      member("here", { status: "active", displayName: "Here", displayTitle: "Dev" }),
    ];
    expect(listUnplacedEmployees(catalog, [])).toEqual([
      { authId: "here", displayName: "Here", displayTitle: "Dev" },
    ]);
  });

  it("ignores header rows when collecting placed auth ids", () => {
    const catalog = [member("solo", { displayName: "Solo", displayTitle: "IC" })];
    const rows = [
      row("h1", "header", { name: "Team" }),
      row("s1", "seat", { members: [] }),
    ];
    expect(listUnplacedEmployees(catalog, rows)).toEqual([
      { authId: "solo", displayName: "Solo", displayTitle: "IC" },
    ]);
  });
});
