import { describe, expect, it } from "vitest";

import { indexFromRows, type ChartRow, type SeatMember } from "../chart/chart-row";
import { buildDirectoryRows } from "./directory-row";

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

// root(Publisher) → eng(header) → platform(header) → seatA(host: amy, peer: ben)
//           → seatB(host: amy)          ← amy holds two seats
//           → vacant seat (no members)
function fixture() {
  const rows = [
    seat("root", "", [member("publisher", "Chief")]),
    header("eng", "root", "Engineering"),
    header("platform", "eng", "Platform"),
    seat(
      "seatA",
      "platform",
      [member("amy", "Amy"), member("ben", "Ben", { isHost: false })],
      "Staff Engineer",
    ),
    seat("seatB", "eng", [member("amy", "Amy")]),
    seat("vacant", "eng", []),
  ];
  return { rows, index: indexFromRows(rows) };
}

describe("buildDirectoryRows", () => {
  it("emits one row per occupied seat, skipping vacant seats", () => {
    const { rows } = fixture();
    const dir = buildDirectoryRows(rows);
    expect(dir.map((r) => r.nodeId).sort()).toEqual(["root", "seatA", "seatB"]);
  });

  it("computes team path from ancestor headers only", () => {
    const { rows } = fixture();
    const dir = buildDirectoryRows(rows);
    expect(dir.find((r) => r.nodeId === "seatA")!.teamPath).toBe(
      "Engineering › Platform",
    );
    expect(dir.find((r) => r.nodeId === "seatB")!.teamPath).toBe("Engineering");
    expect(dir.find((r) => r.nodeId === "root")!.teamPath).toBe("");
  });

  it("finds the manager as host of the nearest ancestor seat", () => {
    const { rows } = fixture();
    const dir = buildDirectoryRows(rows);
    expect(dir.find((r) => r.nodeId === "seatA")!.manager).toBe("Chief");
    expect(dir.find((r) => r.nodeId === "root")!.manager).toBe("");
  });

  it("prefers the seat job title over the member title", () => {
    const { rows } = fixture();
    const dir = buildDirectoryRows(rows);
    expect(dir.find((r) => r.nodeId === "seatA")!.jobTitle).toBe("Staff Engineer");
    expect(dir.find((r) => r.nodeId === "seatB")!.jobTitle).toBe("Amy title");
  });

  it("counts peers and flags multi-role hosts", () => {
    const { rows } = fixture();
    const dir = buildDirectoryRows(rows);
    expect(dir.find((r) => r.nodeId === "seatA")!.peers).toBe(2);
    expect(dir.find((r) => r.nodeId === "seatA")!.multiRole).toBe(true); // amy: seatA + seatB
    expect(dir.find((r) => r.nodeId === "root")!.multiRole).toBe(false);
  });

  it("records ancestor header ids for the subtree filter", () => {
    const { rows } = fixture();
    const dir = buildDirectoryRows(rows);
    expect(dir.find((r) => r.nodeId === "seatA")!.headerPathIds).toEqual([
      "eng",
      "platform",
    ]);
  });
});
