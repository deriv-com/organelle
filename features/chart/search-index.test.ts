import { describe, expect, it } from "vitest";

import type { ChartRow, SeatMember } from "./chart-row";
import { searchChart } from "./search-index";

function member(
  authId: string,
  name: string,
  overrides: Partial<SeatMember> = {},
): SeatMember {
  return {
    authId,
    displayName: name,
    displayTitle: `${name} title`,
    email: `${authId}@example.com`,
    avatarUrl: null,
    officeLocation: "Dubai",
    status: "active",
    joiningDate: null,
    isHost: true,
    sourceName: name,
    sourceTitle: `${name} title`,
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
  jobTitle?: string,
): ChartRow {
  return { id, parentId, kind: "seat", sortOrder: 0, rowVersion: 1, jobTitle, members };
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

function fixture(): ChartRow[] {
  return [
    seat("root", "", [member("publisher", "Chief")]),
    header("eng", "root", "Engineering"),
    header("finance", "root", "Finance"),
    header("platform", "eng", "Platform"),
    seat(
      "seatA",
      "platform",
      [member("amy", "Amy"), member("ben", "Ben", { isHost: false })],
      "Staff Engineer",
    ),
    seat("seatB", "eng", [member("amy", "Amy")]),
    seat("vacant", "eng", [], "Open role"),
  ];
}

describe("searchChart", () => {
  it("finds a team header by name", () => {
    const hits = searchChart(fixture(), "finance");
    expect(hits.some((h) => h.nodeId === "finance" && h.kind === "header")).toBe(true);
    expect(hits.find((h) => h.nodeId === "finance")!.title).toBe("Finance");
  });

  it("returns two seats for a two-role person", () => {
    const hits = searchChart(fixture(), "amy");
    expect(hits.map((h) => h.nodeId).sort()).toEqual(["seatA", "seatB"]);
  });

  it("finds a seat by a non-host peer name", () => {
    const hits = searchChart(fixture(), "ben");
    expect(hits.map((h) => h.nodeId)).toEqual(["seatA"]);
    expect(hits[0]!.title).toBe("Ben");
  });

  it("does not match ordinary text through the shared email domain", () => {
    const rows: ChartRow[] = [
      header("org", "", "Org"),
      seat("cameron-seat", "org", [
        member("cameron", "Cameron Fixture", {
          email: "cameron.fixture@example.com",
        }),
      ]),
      seat("avery-seat", "org", [
        member("avery", "Avery Fixture", { email: "avery.fixture@example.com" }),
      ]),
    ];

    expect(searchChart(rows, "cameron").map((hit) => hit.nodeId)).toEqual([
      "cameron-seat",
    ]);
    expect(
      searchChart(rows, "avery.fixture@example.com").map((hit) => hit.nodeId),
    ).toEqual(["avery-seat"]);
  });

  it("does not index vacant seats", () => {
    expect(searchChart(fixture(), "open role").map((h) => h.nodeId)).not.toContain(
      "vacant",
    );
    expect(searchChart(fixture(), "vacant")).toEqual([]);
  });

  it("can hit a header named Finance", () => {
    expect(searchChart(fixture(), "Finance").map((h) => h.nodeId)).toEqual(["finance"]);
    expect(searchChart(fixture(), "Finance")[0]!.subtitle).toBe("Team");
  });

  it("finds a seat by job title only when titles are included", () => {
    expect(searchChart(fixture(), "Staff Engineer").map((h) => h.nodeId)).toEqual([]);
    const hits = searchChart(fixture(), "Staff Engineer", { includeJobTitle: true });
    expect(hits.map((h) => h.nodeId)).toEqual(["seatA"]);
  });

  it("lists matching people before teams", () => {
    const rows: ChartRow[] = [
      header("root-h", "", "Org"),
      header("talent", "root-h", "Talently"),
      seat("p0", "talent", [member("e0", "Person 0")], "Engineer"),
    ];
    const hits = searchChart(rows, "Talently");
    expect(hits.map((h) => h.kind)).toEqual(["header"]);
    expect(hits[0]).toMatchObject({
      nodeId: "talent",
      kind: "header",
      title: "Talently",
    });
  });

  it("does not match people by team path", () => {
    const rows: ChartRow[] = [
      header("root-h", "", "Org"),
      header("talent", "root-h", "Talently"),
      ...Array.from({ length: 12 }, (_, i) =>
        seat(`p${i}`, "talent", [member(`e${i}`, `Person ${i}`)], "Engineer"),
      ),
    ];
    const hits = searchChart(rows, "Talently");
    expect(hits.every((h) => h.kind === "header")).toBe(true);
    expect(hits.map((h) => h.nodeId)).toEqual(["talent"]);
  });

  it("attaches the matching member avatar", () => {
    const hits = searchChart(
      [
        header("root-h", "", "Org"),
        seat("seatA", "root-h", [
          member("ben", "Ben", { avatarUrl: "https://cdn.example/ben.png" }),
        ]),
      ],
      "ben",
    );
    expect(hits[0]).toMatchObject({
      nodeId: "seatA",
      title: "Ben",
      avatarUrl: "https://cdn.example/ben.png",
    });
  });

  it("colors nested teams by the top-level department", () => {
    const hits = searchChart(fixture(), "Engineering");
    const platform = hits.find((h) => h.nodeId === "platform");
    expect(platform).toMatchObject({ kind: "header", dept: "eng" });
    const finance = searchChart(fixture(), "Finance")[0];
    expect(finance).toMatchObject({ nodeId: "finance", dept: "finance" });
  });
});
