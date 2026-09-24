import { describe, expect, it } from "vitest";

import type { SeatMember } from "../chart/chart-row";
import type { DirectoryRow } from "./directory-row";
import { applyFilters, EMPTY_FILTERS, officeOptions, sortRows } from "./filter";

function row(
  nodeId: string,
  overrides: Partial<Omit<DirectoryRow, "host">> & { host?: Partial<SeatMember> } = {},
): DirectoryRow {
  const { host: hostOverrides, ...rest } = overrides;
  return {
    nodeId,
    host: {
      authId: nodeId,
      displayName: `Person ${nodeId}`,
      displayTitle: "Staff Engineer",
      email: `${nodeId}@example.com`,
      avatarUrl: null,
      officeLocation: "Dubai",
      status: "active",
      joiningDate: null,
      isHost: true,
      sourceName: `Person ${nodeId}`,
      sourceTitle: "Staff Engineer",
      sourceAvatarUrl: null,
      overrideName: null,
      overrideTitle: null,
      overrideAvatarUrl: null,
      ...hostOverrides,
    },
    jobTitle: "Staff Engineer",
    teamPath: "Engineering",
    headerPathIds: ["eng"],
    manager: "Boss",
    peers: 1,
    multiRole: false,
    ...rest,
  };
}

describe("applyFilters", () => {
  const rows = [
    row("a", {
      host: { displayName: "Amy A", officeLocation: "Dubai" },
      headerPathIds: ["eng", "platform"],
    }),
    row("b", {
      host: { displayName: "Ben B", officeLocation: "Malaysia", status: "joining" },
      peers: 3,
    }),
    row("c", {
      host: { displayName: "Cat C" },
      multiRole: true,
      teamPath: "Compliance › AML",
    }),
    row("d", { host: { displayName: "Dee D", status: "serving_notice" } }),
  ];

  it("returns everything with empty filters", () => {
    expect(applyFilters(rows, EMPTY_FILTERS)).toHaveLength(4);
  });

  it("filters by header subtree", () => {
    const out = applyFilters(rows, { ...EMPTY_FILTERS, headerId: "platform" });
    expect(out.map((r) => r.nodeId)).toEqual(["a"]);
  });

  it("filters by office and status", () => {
    expect(
      applyFilters(rows, { ...EMPTY_FILTERS, offices: ["Malaysia"] }).map(
        (r) => r.nodeId,
      ),
    ).toEqual(["b"]);
    expect(
      applyFilters(rows, { ...EMPTY_FILTERS, statuses: ["joining"] }).map(
        (r) => r.nodeId,
      ),
    ).toEqual(["b"]);
    expect(
      applyFilters(rows, { ...EMPTY_FILTERS, statuses: ["serving_notice"] }).map(
        (r) => r.nodeId,
      ),
    ).toEqual(["d"]);
  });

  it("filters has-peers and multi-role", () => {
    expect(
      applyFilters(rows, { ...EMPTY_FILTERS, hasPeers: true }).map((r) => r.nodeId),
    ).toEqual(["b"]);
    expect(
      applyFilters(rows, { ...EMPTY_FILTERS, multiRole: true }).map((r) => r.nodeId),
    ).toEqual(["c"]);
  });

  it("matches free text across name, email, and team path, AND-ing words", () => {
    expect(
      applyFilters(rows, { ...EMPTY_FILTERS, text: "amy" }).map((r) => r.nodeId),
    ).toEqual(["a"]);
    expect(
      applyFilters(rows, { ...EMPTY_FILTERS, text: "b@example" }).map((r) => r.nodeId),
    ).toEqual(["b"]);
    expect(
      applyFilters(rows, { ...EMPTY_FILTERS, text: "aml" }).map((r) => r.nodeId),
    ).toEqual(["c"]);
    expect(applyFilters(rows, { ...EMPTY_FILTERS, text: "staff" })).toHaveLength(0);
    expect(applyFilters(rows, { ...EMPTY_FILTERS, text: "amy malaysia" })).toHaveLength(
      0,
    );
  });

  it("does not match ordinary text through the shared email domain", () => {
    const people = [
      row("cameron", {
        host: { displayName: "Cameron Fixture", email: "cameron.fixture@example.com" },
      }),
      row("avery", {
        host: { displayName: "Avery Fixture", email: "avery.fixture@example.com" },
      }),
    ];

    expect(
      applyFilters(people, { ...EMPTY_FILTERS, text: "cameron" }).map(
        (person) => person.nodeId,
      ),
    ).toEqual(["cameron"]);
    expect(
      applyFilters(people, {
        ...EMPTY_FILTERS,
        text: "avery.fixture@example.com",
      }).map((person) => person.nodeId),
    ).toEqual(["avery"]);
  });

  it("filters 2000 rows well under 50ms", () => {
    const many = Array.from({ length: 2000 }, (_, i) =>
      row(`n${i}`, { host: { officeLocation: i % 7 === 0 ? "Malaysia" : "Dubai" } }),
    );
    const start = performance.now();
    const out = applyFilters(many, {
      ...EMPTY_FILTERS,
      offices: ["Malaysia"],
      text: "person",
    });
    const elapsed = performance.now() - start;
    expect(out.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });
});

describe("sortRows", () => {
  it("sorts by key with a stable secondary sort on name", () => {
    const rows = [
      row("x", { host: { displayName: "Zed" }, teamPath: "B" }),
      row("y", { host: { displayName: "Amy" }, teamPath: "B" }),
      row("z", { host: { displayName: "Mid" }, teamPath: "A" }),
    ];
    expect(sortRows(rows, "teamPath").map((r) => r.host.displayName)).toEqual([
      "Mid",
      "Amy",
      "Zed",
    ]);
    expect(sortRows(rows, "name").map((r) => r.host.displayName)).toEqual([
      "Amy",
      "Mid",
      "Zed",
    ]);
    expect(sortRows(rows, "name", "desc").map((r) => r.host.displayName)).toEqual([
      "Zed",
      "Mid",
      "Amy",
    ]);
  });
});

describe("officeOptions", () => {
  it("returns distinct sorted offices, skipping blanks", () => {
    const rows = [
      row("a", { host: { officeLocation: "Malaysia" } }),
      row("b", { host: { officeLocation: "Dubai" } }),
      row("c", { host: { officeLocation: "" } }),
      row("d", { host: { officeLocation: "Dubai" } }),
    ];
    expect(officeOptions(rows)).toEqual(["Dubai", "Malaysia"]);
  });
});
