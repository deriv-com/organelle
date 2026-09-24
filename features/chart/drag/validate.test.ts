import { describe, expect, it } from "vitest";

import { indexFromRows, type ChartRow, type SeatMember } from "../chart-row";
import { validateDrop, validateMemberDrop, canBeAssistant } from "./validate";
import type { Zone } from "./zone";

let seq = 0;
function member(authId: string): SeatMember {
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
  };
}

function row(
  id: string,
  parentId: string | "",
  kind: "header" | "seat",
  members: string[] = [],
): ChartRow {
  return {
    id,
    parentId,
    kind,
    sortOrder: seq++,
    rowVersion: 1,
    members: members.map(member),
  };
}

// root(seat) -> a(header) -> b(seat, m1), c(seat, m2); root -> d(header) -> e(seat, m3)
function fixture() {
  seq = 0;
  const rows = [
    row("root", "", "seat", ["publisher"]),
    row("a", "root", "header"),
    row("b", "a", "seat", ["m1"]),
    row("c", "a", "seat", ["m2"]),
    row("d", "root", "header"),
    row("e", "d", "seat", ["m3"]),
  ];
  return { rows, index: indexFromRows(rows) };
}

const child: Zone = { zone: "child" };
const peer: Zone = { zone: "peer" };
const sibBefore: Zone = { zone: "sibling-before" };

describe("validateDrop", () => {
  it("rejects moving the root", () => {
    const { rows, index } = fixture();
    expect(validateDrop(rows, index, "root", "a", child)).toEqual({
      ok: false,
      reason: "Can't move the root",
    });
  });

  it("rejects dropping a node onto itself", () => {
    const { rows, index } = fixture();
    expect(validateDrop(rows, index, "b", "b", child)).toMatchObject({ ok: false });
  });

  it("rejects moving a node into its own subtree (cycle)", () => {
    const { rows, index } = fixture();
    const verdict = validateDrop(rows, index, "a", "b", child);
    expect(verdict).toEqual({
      ok: false,
      reason: "Can't move a node into its own team",
    });
  });

  it("rejects a sibling insert next to the root (would create a second root)", () => {
    const { rows, index } = fixture();
    expect(validateDrop(rows, index, "a", "root", sibBefore)).toEqual({
      ok: false,
      reason: "Can't move the root",
    });
  });

  it("allows a plain reparent", () => {
    const { rows, index } = fixture();
    expect(validateDrop(rows, index, "b", "d", child)).toMatchObject({ ok: true });
  });

  it("rejects a child drop onto the current parent (gap reorder is the only same-parent move)", () => {
    const { rows, index } = fixture();
    expect(validateDrop(rows, index, "b", "a", child)).toEqual({
      ok: false,
      reason: "Already under this manager",
    });
  });

  it("allows a sibling insert", () => {
    const { rows, index } = fixture();
    expect(validateDrop(rows, index, "b", "e", sibBefore)).toMatchObject({ ok: true });
  });

  it("allows a same-parent sibling gap insert", () => {
    const { rows, index } = fixture();
    expect(validateDrop(rows, index, "b", "c", sibBefore)).toMatchObject({ ok: true });
  });

  it("rejects a header dragged onto a peer zone", () => {
    const { rows, index } = fixture();
    expect(validateDrop(rows, index, "a", "c", peer)).toEqual({
      ok: false,
      reason: "Can't merge a team into a seat",
    });
  });

  it("rejects a peer drop when a member is already on the target seat", () => {
    const { rows, index } = fixture();
    rows.find((r) => r.id === "c")!.members.push(member("m1"));
    expect(validateDrop(rows, index, "b", "c", peer)).toEqual({
      ok: false,
      reason: "Already on that seat",
    });
  });

  it("allows a seat peer drop", () => {
    const { rows, index } = fixture();
    expect(validateDrop(rows, index, "b", "c", peer)).toMatchObject({ ok: true });
  });

  it("rejects drops that would exceed depth 16", () => {
    seq = 0;
    const rows = [row("root", "", "seat", ["publisher"])];
    let parent = "root";
    for (let i = 1; i <= 15; i++) {
      rows.push(row(`n${i}`, parent, "header"));
      parent = `n${i}`;
    }
    rows.push(row("s", "root", "header"));
    rows.push(row("s-kid", "s", "header"));
    const index = indexFromRows(rows);

    // s has height 1; under n15 (depth 16): 16 + 1 + 1 = 18 -> reject.
    expect(validateDrop(rows, index, "s", "n15", child)).toMatchObject({ ok: false });
    // Under n14 (depth 15): 15 + 1 + 1 = 17 -> still reject.
    expect(validateDrop(rows, index, "s", "n14", child)).toMatchObject({ ok: false });
    // Under n13 (depth 14): 14 + 1 + 1 = 16 -> allow.
    expect(validateDrop(rows, index, "s", "n13", child)).toMatchObject({ ok: true });
  });
});

describe("validateMemberDrop", () => {
  it("rejects a drop onto the source seat", () => {
    const { rows, index } = fixture();
    expect(validateMemberDrop(rows, index, "b", "m1", "b", child)).toEqual({
      ok: false,
      reason: "Already on this seat",
    });
  });

  it("rejects a peer drop onto a header", () => {
    const { rows, index } = fixture();
    expect(validateMemberDrop(rows, index, "b", "m1", "a", peer)).toEqual({
      ok: false,
      reason: "Can't merge into a team",
    });
  });

  it("rejects a peer drop when the person is already on the target seat", () => {
    const { rows, index } = fixture();
    rows.find((r) => r.id === "c")!.members.push(member("m1"));
    expect(validateMemberDrop(rows, index, "b", "m1", "c", peer)).toEqual({
      ok: false,
      reason: "Already on that seat",
    });
  });

  it("allows a member peer drop onto another seat", () => {
    const { rows, index } = fixture();
    expect(validateMemberDrop(rows, index, "b", "m1", "c", peer)).toMatchObject({
      ok: true,
    });
  });

  it("allows a new-seat drop under a header or beside a sibling", () => {
    const { rows, index } = fixture();
    expect(validateMemberDrop(rows, index, "b", "m1", "d", child)).toMatchObject({
      ok: true,
    });
    expect(validateMemberDrop(rows, index, "b", "m1", "e", sibBefore)).toMatchObject({
      ok: true,
    });
  });

  it("rejects moving the last member off the root seat", () => {
    const { rows, index } = fixture();
    expect(validateMemberDrop(rows, index, "root", "publisher", "c", peer)).toEqual({
      ok: false,
      reason: "Can't move the last member off the root seat",
    });
  });

  it("allows emptying a non-root seat (it dissolves)", () => {
    const { rows, index } = fixture();
    expect(validateMemberDrop(rows, index, "b", "m1", "c", peer)).toMatchObject({
      ok: true,
    });
  });

  it("rejects a new-seat drop that would exceed depth 16", () => {
    seq = 0;
    const rows = [row("root", "", "seat", ["publisher"])];
    let parent = "root";
    for (let i = 1; i <= 15; i++) {
      rows.push(row(`n${i}`, parent, "header"));
      parent = `n${i}`;
    }
    rows.push(row("b", "root", "seat", ["m1"]));
    const index = indexFromRows(rows);

    // New seat under n15 (depth 16) would sit at depth 17 -> reject.
    expect(validateMemberDrop(rows, index, "b", "m1", "n15", child)).toMatchObject({
      ok: false,
    });
    // Under n14 (depth 15): new seat at depth 16 -> allow.
    expect(validateMemberDrop(rows, index, "b", "m1", "n14", child)).toMatchObject({
      ok: true,
    });
  });
});

describe("assistant placement", () => {
  function seats() {
    seq = 0;
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("boss", "root", "seat", ["boss"]),
      row("kid", "boss", "seat", ["kid"]),
      row("peer", "boss", "seat", ["peer"]),
      row("hdr", "root", "header"),
      row("underH", "hdr", "seat", ["h1"]),
    ];
    return { rows, index: indexFromRows(rows) };
  }

  it("rejects placing when the parent already has an assistant", () => {
    const { rows } = seats();
    rows.find((r) => r.id === "kid")!.isAssistant = true;
    expect(canBeAssistant(rows, indexFromRows(rows), "peer", "boss")).toEqual({
      ok: false,
      reason: "Already has an assistant",
    });
  });

  it("rejects a source with children", () => {
    const { rows, index } = seats();
    expect(canBeAssistant(rows, index, "boss", "root")).toEqual({
      ok: false,
      reason: "Can't make a manager an assistant",
    });
  });

  it("rejects vacant and peer-stack sources", () => {
    const { rows } = seats();
    rows.find((r) => r.id === "kid")!.members = [];
    expect(canBeAssistant(rows, indexFromRows(rows), "kid", "boss")).toEqual({
      ok: false,
      reason: "Assistant must be one person",
    });
    const { rows: stacked } = seats();
    stacked
      .find((r) => r.id === "kid")!
      .members.push({
        ...stacked.find((r) => r.id === "kid")!.members[0]!,
        authId: "extra",
        isHost: false,
      });
    expect(canBeAssistant(stacked, indexFromRows(stacked), "kid", "boss")).toEqual({
      ok: false,
      reason: "Assistant must be one person",
    });
  });

  it("rejects a header parent", () => {
    const { rows, index } = seats();
    expect(canBeAssistant(rows, index, "underH", "hdr")).toEqual({
      ok: false,
      reason: "Assistants only under a person",
    });
  });

  it("allows a child drop onto the current parent to unconvert", () => {
    const { rows } = seats();
    rows.find((r) => r.id === "kid")!.isAssistant = true;
    expect(validateDrop(rows, indexFromRows(rows), "kid", "boss", child)).toMatchObject(
      {
        ok: true,
      },
    );
  });

  it("rejects a drop onto an assistant card", () => {
    const { rows } = seats();
    rows.find((r) => r.id === "kid")!.isAssistant = true;
    expect(validateDrop(rows, indexFromRows(rows), "peer", "kid", child)).toEqual({
      ok: false,
      reason: "Can't drop onto an assistant",
    });
  });
});
