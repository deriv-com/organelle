import { describe, expect, it } from "vitest";

import { indexFromRows, orderRows, type ChartRow, type SeatMember } from "../chart-row";
import { PAGE_SIZE } from "../collapse";
import {
  applyCreate,
  applyDelete,
  applyMemberMove,
  applyMemberNewSeat,
  applyMove,
  applyMoveNodeOnly,
  applyPeer,
  applySetAssistant,
  applySetLeafGridColumns,
  toDrop,
  toMemberDrop,
  shouldAskMoveMode,
} from "./apply";

let seq = 0;
function member(authId: string, isHost = true): SeatMember {
  return {
    authId,
    displayName: authId,
    displayTitle: "",
    email: "",
    avatarUrl: null,
    officeLocation: "",
    status: "active",
    joiningDate: null,
    isHost,
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
    leafGridColumns: 3,
    members: members.map((m) => member(m)),
  };
}

// root -> p -> s1, s2, s3; root -> q -> t1
function fixture() {
  seq = 0;
  const rows = [
    row("root", "", "seat", ["publisher"]),
    row("p", "root", "header"),
    row("s1", "p", "seat", ["m1"]),
    row("s2", "p", "seat", ["m2"]),
    row("s3", "p", "seat", ["m3"]),
    row("q", "root", "header"),
    row("t1", "q", "seat", ["m4"]),
  ];
  return { rows, index: indexFromRows(rows) };
}

function siblingsOf(rows: ChartRow[], parentId: string): string[] {
  return rows
    .filter((r) => r.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => r.id);
}

describe("toDrop", () => {
  it("maps child zone to append-last move", () => {
    const { rows } = fixture();
    expect(
      toDrop("s1", { ok: true, zone: { zone: "child" }, targetId: "q" }, rows),
    ).toEqual({ kind: "move", nodeId: "s1", newParentId: "q", beforeSiblingId: null });
  });

  it("maps sibling-after to the next sibling (or null at the end)", () => {
    const { rows } = fixture();
    expect(
      toDrop("t1", { ok: true, zone: { zone: "sibling-after" }, targetId: "s1" }, rows),
    ).toEqual({ kind: "move", nodeId: "t1", newParentId: "p", beforeSiblingId: "s2" });
    expect(
      toDrop("t1", { ok: true, zone: { zone: "sibling-after" }, targetId: "s3" }, rows),
    ).toEqual({ kind: "move", nodeId: "t1", newParentId: "p", beforeSiblingId: null });
  });

  it("maps peer zone to a peer drop", () => {
    const { rows } = fixture();
    expect(
      toDrop("s1", { ok: true, zone: { zone: "peer" }, targetId: "t1" }, rows),
    ).toEqual({
      kind: "peer",
      sourceSeatId: "s1",
      targetSeatId: "t1",
    });
  });
});

describe("shouldAskMoveMode", () => {
  it("skips the dialog for a same-parent reorder even when the node has children", () => {
    const { rows } = fixture();
    expect(
      shouldAskMoveMode(
        { kind: "move", nodeId: "p", newParentId: "root", beforeSiblingId: "q" },
        rows,
      ),
    ).toBe(false);
  });

  it("asks when reparenting a node that has children", () => {
    const { rows } = fixture();
    expect(
      shouldAskMoveMode(
        { kind: "move", nodeId: "p", newParentId: "q", beforeSiblingId: null },
        rows,
      ),
    ).toBe(true);
  });

  it("skips when the node has no children", () => {
    const { rows } = fixture();
    expect(
      shouldAskMoveMode(
        { kind: "move", nodeId: "s1", newParentId: "q", beforeSiblingId: null },
        rows,
      ),
    ).toBe(false);
  });
});

describe("applyMove", () => {
  it("reparents, appends last, and resequences both sibling groups", () => {
    const { rows } = fixture();
    const next = applyMove(rows, {
      kind: "move",
      nodeId: "s1",
      newParentId: "q",
      beforeSiblingId: null,
    });
    expect(siblingsOf(next, "q")).toEqual(["t1", "s1"]);
    expect(siblingsOf(next, "p")).toEqual(["s2", "s3"]);
    expect(next.find((r) => r.id === "s1")!.parentId).toBe("q");
    // The result still forms a valid tree.
    expect(() => indexFromRows(next)).not.toThrow();
  });

  it("inserts before the given sibling for reorder", () => {
    const { rows } = fixture();
    const next = applyMove(rows, {
      kind: "move",
      nodeId: "s3",
      newParentId: "p",
      beforeSiblingId: "s1",
    });
    expect(siblingsOf(next, "p")).toEqual(["s3", "s1", "s2"]);
  });

  it("orderRows after a reorder emits siblings in the new array order", () => {
    const { rows } = fixture();
    const next = orderRows(
      applyMove(rows, {
        kind: "move",
        nodeId: "s3",
        newParentId: "p",
        beforeSiblingId: "s1",
      }),
    );
    expect(next.filter((r) => r.parentId === "p").map((r) => r.id)).toEqual([
      "s3",
      "s1",
      "s2",
    ]);
  });

  it("pages the parent forward when the drop lands beyond the visible page", () => {
    seq = 0;
    const rows = [row("root", "", "seat", ["publisher"]), row("big", "root", "header")];
    for (let i = 0; i < PAGE_SIZE + 5; i++)
      rows.push(row(`k${i}`, "big", "seat", [`x${i}`]));
    rows.push(row("mover", "root", "header"));
    const next = applyMove(rows, {
      kind: "move",
      nodeId: "mover",
      newParentId: "big",
      beforeSiblingId: null,
    });
    const parent = next.find((r) => r.id === "big")!;
    expect(parent._pagingStep).toBe(Math.ceil((PAGE_SIZE + 6) / PAGE_SIZE));
  });

  it("composes two successive moves so the second sees the first parent change", () => {
    const { rows } = fixture();
    const afterFirst = applyMove(rows, {
      kind: "move",
      nodeId: "s1",
      newParentId: "q",
      beforeSiblingId: null,
    });
    const afterSecond = applyMove(afterFirst, {
      kind: "move",
      nodeId: "s2",
      newParentId: "q",
      beforeSiblingId: null,
    });
    expect(siblingsOf(afterSecond, "q")).toEqual(["t1", "s1", "s2"]);
    expect(siblingsOf(afterSecond, "p")).toEqual(["s3"]);
    expect(afterSecond.find((r) => r.id === "s1")!.parentId).toBe("q");
    expect(afterSecond.find((r) => r.id === "s2")!.parentId).toBe("q");
    // Applying the second drop to the original tree would drop s1's move.
    const stale = applyMove(rows, {
      kind: "move",
      nodeId: "s2",
      newParentId: "q",
      beforeSiblingId: null,
    });
    expect(stale.find((r) => r.id === "s1")!.parentId).toBe("p");
    expect(() => indexFromRows(afterSecond)).not.toThrow();
  });
});

describe("applyPeer", () => {
  it("moves members as non-hosts, dissolves the source, reparents its children", () => {
    seq = 0;
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("p", "root", "header"),
      row("src", "p", "seat", ["m1", "m2"]),
      row("src-kid", "src", "header"),
      row("dst", "p", "seat", ["m9"]),
    ];
    const next = applyPeer(rows, {
      kind: "peer",
      sourceSeatId: "src",
      targetSeatId: "dst",
    });

    expect(next.find((r) => r.id === "src")).toBeUndefined();
    const dst = next.find((r) => r.id === "dst")!;
    expect(dst.members.map((m) => m.authId)).toEqual(["m9", "m1", "m2"]);
    expect(dst.members[0]!.isHost).toBe(true);
    expect(dst.members.slice(1).every((m) => !m.isHost)).toBe(true);

    const kid = next.find((r) => r.id === "src-kid")!;
    expect(kid.parentId).toBe("p");
    expect(siblingsOf(next, "p")).toEqual(["dst", "src-kid"]);
    expect(() => indexFromRows(next)).not.toThrow();
  });
});

describe("applyDelete", () => {
  it("removes a header and splices its children at its former position", () => {
    seq = 0;
    // root -> a, h, b; h -> c1, c2 (sortOrder is per-parent, like the DB)
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("a", "root", "header"),
      row("h", "root", "header"),
      row("b", "root", "header"),
      row("c1", "h", "seat", ["m1"]),
      row("c2", "h", "seat", ["m2"]),
    ];
    rows.find((r) => r.id === "a")!.sortOrder = 0;
    rows.find((r) => r.id === "h")!.sortOrder = 1;
    rows.find((r) => r.id === "b")!.sortOrder = 2;
    rows.find((r) => r.id === "c1")!.sortOrder = 0;
    rows.find((r) => r.id === "c2")!.sortOrder = 1;
    const next = applyDelete(rows, "h");

    expect(next.find((r) => r.id === "h")).toBeUndefined();
    expect(siblingsOf(next, "root")).toEqual(["a", "c1", "c2", "b"]);
    expect(next.every((r) => r.parentId !== "h")).toBe(true);
    expect(() => indexFromRows(next)).not.toThrow();
  });

  it("removes a seat with members; children reparent to the grandparent", () => {
    seq = 0;
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("p", "root", "header"),
      row("s", "p", "seat", ["m1", "m2"]),
      row("kid", "s", "seat", ["m3"]),
    ];
    const next = applyDelete(rows, "s");

    expect(next.find((r) => r.id === "s")).toBeUndefined();
    expect(next.find((r) => r.id === "kid")!.parentId).toBe("p");
    expect(siblingsOf(next, "p")).toEqual(["kid"]);
  });

  it("appends children last when the deleted node was the last sibling", () => {
    seq = 0;
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("a", "root", "header"),
      row("h", "root", "header"),
      row("c1", "h", "header"),
    ];
    const next = applyDelete(rows, "h");
    expect(siblingsOf(next, "root")).toEqual(["a", "c1"]);
  });

  it("refuses to delete the root", () => {
    const { rows } = fixture();
    expect(applyDelete(rows, "root")).toBe(rows);
  });

  it("promotes another seat to primary when the primary seat is deleted", () => {
    seq = 0;
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("a", "root", "seat", ["ada"]),
      row("b", "root", "seat", ["ada"]),
    ];
    rows.find((r) => r.id === "a")!.members[0]!.isPrimary = true;
    rows.find((r) => r.id === "b")!.members[0]!.isPrimary = false;
    const next = applyDelete(rows, "a");
    expect(next.find((r) => r.id === "b")!.members[0]!.isPrimary).toBe(true);
  });
});

describe("applyMoveNodeOnly", () => {
  it("splices the children into the old parent at the node's former position", () => {
    seq = 0;
    // root -> a, h, b; h -> c1, c2; c1 -> g1 (sortOrder is per-parent)
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("a", "root", "header"),
      row("h", "root", "header"),
      row("b", "root", "header"),
      row("c1", "h", "seat", ["m1"]),
      row("c2", "h", "seat", ["m2"]),
      row("g1", "c1", "seat", ["m3"]),
    ];
    const sort: Record<string, number> = {
      root: 0,
      a: 0,
      h: 1,
      b: 2,
      c1: 0,
      c2: 1,
      g1: 0,
    };
    rows.forEach((r) => {
      r.sortOrder = sort[r.id];
    });
    const next = applyMoveNodeOnly(rows, {
      kind: "move",
      nodeId: "h",
      newParentId: "a",
      beforeSiblingId: null,
    });

    // Children reattached to root where h used to sit: a, c1, c2, b.
    expect(siblingsOf(next, "root")).toEqual(["a", "c1", "c2", "b"]);
    // The node landed under the target.
    expect(siblingsOf(next, "a")).toEqual(["h"]);
    // Grandchild untouched — still under its own parent.
    expect(siblingsOf(next, "c1")).toEqual(["g1"]);
    expect(() => indexFromRows(next)).not.toThrow();
  });

  it("keeps sibling order consistent when moving within the same parent", () => {
    seq = 0;
    // root -> a, h, b; h -> c1 (sortOrder is per-parent)
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("a", "root", "header"),
      row("h", "root", "header"),
      row("b", "root", "header"),
      row("c1", "h", "seat", ["m1"]),
    ];
    const sort: Record<string, number> = { root: 0, a: 0, h: 1, b: 2, c1: 0 };
    rows.forEach((r) => {
      r.sortOrder = sort[r.id];
    });
    // Move h to the end of its own parent, node-only.
    const next = applyMoveNodeOnly(rows, {
      kind: "move",
      nodeId: "h",
      newParentId: "root",
      beforeSiblingId: null,
    });

    expect(siblingsOf(next, "root")).toEqual(["a", "c1", "b", "h"]);
    expect(() => indexFromRows(next)).not.toThrow();
  });

  it("composes node-only after a prior subtree move", () => {
    seq = 0;
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("a", "root", "header"),
      row("h", "root", "header"),
      row("b", "root", "header"),
      row("c1", "h", "seat", ["m1"]),
    ];
    const sort: Record<string, number> = { root: 0, a: 0, h: 1, b: 2, c1: 0 };
    rows.forEach((r) => {
      r.sortOrder = sort[r.id];
    });
    const afterSubtree = applyMove(rows, {
      kind: "move",
      nodeId: "b",
      newParentId: "a",
      beforeSiblingId: null,
    });
    const afterNodeOnly = applyMoveNodeOnly(afterSubtree, {
      kind: "move",
      nodeId: "h",
      newParentId: "a",
      beforeSiblingId: null,
    });
    expect(siblingsOf(afterNodeOnly, "a")).toEqual(["b", "h"]);
    expect(siblingsOf(afterNodeOnly, "root")).toEqual(["a", "c1"]);
    expect(afterNodeOnly.find((r) => r.id === "b")!.parentId).toBe("a");
    expect(() => indexFromRows(afterNodeOnly)).not.toThrow();
  });

  it("refuses to move the root", () => {
    const { rows } = fixture();
    expect(
      applyMoveNodeOnly(rows, {
        kind: "move",
        nodeId: "root",
        newParentId: "a",
        beforeSiblingId: null,
      }),
    ).toBe(rows);
  });
});

describe("toMemberDrop", () => {
  it("maps a peer zone to a member-peer drop", () => {
    const { rows } = fixture();
    expect(
      toMemberDrop(
        "s1",
        "m1",
        { ok: true, zone: { zone: "peer" }, targetId: "t1" },
        rows,
      ),
    ).toEqual({
      kind: "member-peer",
      sourceSeatId: "s1",
      authId: "m1",
      targetSeatId: "t1",
    });
  });

  it("maps a child zone to a member-new-seat drop appended last", () => {
    const { rows } = fixture();
    expect(
      toMemberDrop(
        "s1",
        "m1",
        { ok: true, zone: { zone: "child" }, targetId: "q" },
        rows,
      ),
    ).toEqual({
      kind: "member-new-seat",
      sourceSeatId: "s1",
      authId: "m1",
      parentId: "q",
      beforeSiblingId: null,
    });
  });

  it("maps sibling-after to the next sibling (or null at the end)", () => {
    const { rows } = fixture();
    expect(
      toMemberDrop(
        "t1",
        "m4",
        { ok: true, zone: { zone: "sibling-after" }, targetId: "s1" },
        rows,
      ),
    ).toEqual({
      kind: "member-new-seat",
      sourceSeatId: "t1",
      authId: "m4",
      parentId: "p",
      beforeSiblingId: "s2",
    });
    expect(
      toMemberDrop(
        "t1",
        "m4",
        { ok: true, zone: { zone: "sibling-after" }, targetId: "s3" },
        rows,
      ),
    ).toEqual({
      kind: "member-new-seat",
      sourceSeatId: "t1",
      authId: "m4",
      parentId: "p",
      beforeSiblingId: null,
    });
  });
});

describe("applyMemberMove", () => {
  function peerFixture() {
    seq = 0;
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("p", "root", "header"),
      row("src", "p", "seat"),
      row("src-kid", "src", "header"),
      row("dst", "p", "seat"),
    ];
    rows.find((r) => r.id === "src")!.members = [
      member("m1", true),
      member("m2", false),
    ];
    rows.find((r) => r.id === "dst")!.members = [member("m9", true)];
    return rows;
  }

  it("moves one member as a non-host and keeps the source seat", () => {
    const rows = peerFixture();
    const next = applyMemberMove(rows, {
      kind: "member-peer",
      sourceSeatId: "src",
      authId: "m2",
      targetSeatId: "dst",
    });

    const src = next.find((r) => r.id === "src")!;
    expect(src.members.map((m) => m.authId)).toEqual(["m1"]);
    expect(src.members[0]!.isHost).toBe(true);
    const dst = next.find((r) => r.id === "dst")!;
    expect(dst.members.map((m) => m.authId)).toEqual(["m9", "m2"]);
    expect(dst.members[0]!.isHost).toBe(true);
    expect(dst.members[1]!.isHost).toBe(false);
  });

  it("promotes the next member when the host is dragged out", () => {
    const rows = peerFixture();
    const next = applyMemberMove(rows, {
      kind: "member-peer",
      sourceSeatId: "src",
      authId: "m1",
      targetSeatId: "dst",
    });

    const src = next.find((r) => r.id === "src")!;
    expect(src.members.map((m) => m.authId)).toEqual(["m2"]);
    expect(src.members[0]!.isHost).toBe(true);
  });

  it("dissolves the emptied source and splices its children at its position", () => {
    seq = 0;
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("p", "root", "header"),
      row("src", "p", "seat"),
      row("src-kid", "src", "header"),
      row("dst", "p", "seat"),
    ];
    rows.find((r) => r.id === "src")!.members = [member("m1", true)];
    rows.find((r) => r.id === "dst")!.members = [member("m9", true)];
    // Per-parent sortOrder, like the DB.
    rows.find((r) => r.id === "src")!.sortOrder = 0;
    rows.find((r) => r.id === "dst")!.sortOrder = 1;
    const next = applyMemberMove(rows, {
      kind: "member-peer",
      sourceSeatId: "src",
      authId: "m1",
      targetSeatId: "dst",
    });

    expect(next.find((r) => r.id === "src")).toBeUndefined();
    expect(next.find((r) => r.id === "src-kid")!.parentId).toBe("p");
    expect(siblingsOf(next, "p")).toEqual(["src-kid", "dst"]);
    const dst = next.find((r) => r.id === "dst")!;
    expect(dst.members.map((m) => m.authId)).toEqual(["m9", "m1"]);
    expect(() => indexFromRows(next)).not.toThrow();
  });
});

describe("applyMemberNewSeat", () => {
  it("creates a host seat at the drop position and keeps remaining members", () => {
    seq = 0;
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("p", "root", "header"),
      row("src", "p", "seat"),
      row("s2", "p", "seat", ["m9"]),
    ];
    rows.find((r) => r.id === "src")!.members = [
      member("m1", true),
      member("m2", false),
    ];
    const next = applyMemberNewSeat(rows, {
      kind: "member-new-seat",
      sourceSeatId: "src",
      authId: "m2",
      parentId: "p",
      beforeSiblingId: "s2",
      newSeatId: "new",
    });

    const created = next.find((r) => r.id === "new")!;
    expect(created.parentId).toBe("p");
    expect(created.members.map((m) => m.authId)).toEqual(["m2"]);
    expect(created.members[0]!.isHost).toBe(true);
    const src = next.find((r) => r.id === "src")!;
    expect(src.members.map((m) => m.authId)).toEqual(["m1"]);
    expect(src.members[0]!.isHost).toBe(true);
    expect(siblingsOf(next, "p")).toEqual(["src", "new", "s2"]);
    expect(() => indexFromRows(next)).not.toThrow();
  });

  it("promotes the next member when the host leaves for a new seat", () => {
    seq = 0;
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("p", "root", "header"),
      row("src", "p", "seat"),
    ];
    rows.find((r) => r.id === "src")!.members = [
      member("m1", true),
      member("m2", false),
    ];
    const next = applyMemberNewSeat(rows, {
      kind: "member-new-seat",
      sourceSeatId: "src",
      authId: "m1",
      parentId: "p",
      beforeSiblingId: null,
      newSeatId: "new",
    });
    expect(
      next.find((r) => r.id === "src")!.members.map((m) => [m.authId, m.isHost]),
    ).toEqual([["m2", true]]);
  });

  it("dissolves the emptied source and splices its children at its position", () => {
    seq = 0;
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("p", "root", "header"),
      row("src", "p", "seat"),
      row("src-kid", "src", "header"),
      row("s2", "p", "seat", ["m9"]),
    ];
    rows.find((r) => r.id === "src")!.members = [member("m1", true)];
    rows.find((r) => r.id === "src")!.sortOrder = 0;
    rows.find((r) => r.id === "s2")!.sortOrder = 1;
    const next = applyMemberNewSeat(rows, {
      kind: "member-new-seat",
      sourceSeatId: "src",
      authId: "m1",
      parentId: "p",
      beforeSiblingId: "s2",
      newSeatId: "new",
    });

    expect(next.find((r) => r.id === "src")).toBeUndefined();
    expect(next.find((r) => r.id === "src-kid")!.parentId).toBe("p");
    expect(siblingsOf(next, "p")).toEqual(["src-kid", "new", "s2"]);
    expect(next.find((r) => r.id === "new")!.members[0]!.isHost).toBe(true);
    expect(() => indexFromRows(next)).not.toThrow();
  });
});

describe("applyCreate", () => {
  it("appends a named header last under the parent", () => {
    const { rows } = fixture();
    const next = applyCreate(rows, {
      kind: "header",
      nodeId: "new-team",
      parentId: "p",
      name: "New team",
    });
    expect(siblingsOf(next, "p")).toEqual(["s1", "s2", "s3", "new-team"]);
    const created = next.find((r) => r.id === "new-team")!;
    expect(created.kind).toBe("header");
    expect(created.name).toBe("New team");
    expect(created.rowVersion).toBe(1);
    expect(next.find((r) => r.id === "p")!._expanded).toBe(true);
    expect(() => indexFromRows(next)).not.toThrow();
  });

  it("appends a seat with the employee as host", () => {
    const { rows } = fixture();
    const next = applyCreate(rows, {
      kind: "seat",
      nodeId: "new-seat",
      parentId: "q",
      member: member("hired"),
      jobTitle: "Engineer",
    });
    expect(siblingsOf(next, "q")).toEqual(["t1", "new-seat"]);
    const created = next.find((r) => r.id === "new-seat")!;
    expect(created.kind).toBe("seat");
    expect(created.jobTitle).toBe("Engineer");
    expect(created.members).toEqual([
      expect.objectContaining({ authId: "hired", isHost: true, isPrimary: true }),
    ]);
  });

  it("marks a second seat for the same person as secondary", () => {
    const { rows } = fixture();
    const next = applyCreate(rows, {
      kind: "seat",
      nodeId: "second",
      parentId: "q",
      member: member("m1"),
      jobTitle: "Advisor",
    });
    expect(next.find((r) => r.id === "second")!.members[0]).toEqual(
      expect.objectContaining({ authId: "m1", isPrimary: false }),
    );
  });

  it("stores the submitted seat title, not the employee's directory title", () => {
    const { rows } = fixture();
    const hired = { ...member("hired"), displayTitle: "Engineer" };
    const next = applyCreate(rows, {
      kind: "seat",
      nodeId: "new-seat",
      parentId: "q",
      member: hired,
      jobTitle: "Head of Platform",
    });
    expect(next.find((r) => r.id === "new-seat")!.jobTitle).toBe("Head of Platform");
  });
});

describe("assistant apply", () => {
  it("converts and unconverts on the same parent", () => {
    seq = 0;
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("boss", "root", "seat", ["boss"]),
      row("kid", "boss", "seat", ["kid"]),
    ];
    const converted = applySetAssistant(rows, "kid", true);
    expect(converted.find((r) => r.id === "kid")!.isAssistant).toBe(true);
    const team = applySetAssistant(converted, "kid", false);
    expect(team.find((r) => r.id === "kid")!.isAssistant).toBe(false);
  });
});

describe("leaf grid columns apply", () => {
  it("sets and clamps column count on the parent node", () => {
    seq = 0;
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("parent", "root", "header"),
    ];
    const one = applySetLeafGridColumns(rows, "parent", 1);
    expect(one.find((r) => r.id === "parent")!.leafGridColumns).toBe(1);
    const four = applySetLeafGridColumns(rows, "parent", 4);
    expect(four.find((r) => r.id === "parent")!.leafGridColumns).toBe(4);
    const clampedHigh = applySetLeafGridColumns(four, "parent", 99);
    expect(clampedHigh.find((r) => r.id === "parent")!.leafGridColumns).toBe(5);
    const clampedLow = applySetLeafGridColumns(four, "parent", 0);
    expect(clampedLow.find((r) => r.id === "parent")!.leafGridColumns).toBe(1);
    const clampedNeg = applySetLeafGridColumns(four, "parent", -3);
    expect(clampedNeg.find((r) => r.id === "parent")!.leafGridColumns).toBe(1);
  });
});

describe("assistant apply gap unconvert", () => {
  it("gap unconvert clears the flag via applyMove", () => {
    seq = 0;
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("boss", "root", "seat", ["boss"]),
      row("kid", "boss", "seat", ["kid"]),
      row("peer", "boss", "seat", ["peer"]),
    ];
    rows.find((r) => r.id === "kid")!.isAssistant = true;
    const next = applyMove(rows, {
      kind: "move",
      nodeId: "kid",
      newParentId: "boss",
      beforeSiblingId: "peer",
    });
    expect(next.find((r) => r.id === "kid")!.isAssistant).toBeFalsy();
  });

  it("move as child clears the flag", () => {
    seq = 0;
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("boss", "root", "seat", ["boss"]),
      row("kid", "boss", "seat", ["kid"]),
      row("other", "root", "seat", ["o"]),
    ];
    rows.find((r) => r.id === "kid")!.isAssistant = true;
    const next = applyMove(rows, {
      kind: "move",
      nodeId: "kid",
      newParentId: "other",
      beforeSiblingId: null,
    });
    expect(next.find((r) => r.id === "kid")!.isAssistant).toBeFalsy();
  });

  it("move as assistant sets the flag", () => {
    seq = 0;
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("boss", "root", "seat", ["boss"]),
      row("kid", "root", "seat", ["kid"]),
    ];
    const next = applyMove(rows, {
      kind: "move",
      nodeId: "kid",
      newParentId: "boss",
      beforeSiblingId: null,
      asAssistant: true,
    });
    expect(next.find((r) => r.id === "kid")!.isAssistant).toBe(true);
    expect(next.find((r) => r.id === "kid")!.parentId).toBe("boss");
  });

  it("delete-clash clears leftover assistant", () => {
    seq = 0;
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("gp", "root", "seat", ["gp"]),
      row("gp-asst", "gp", "seat", ["ga"]),
      row("boss", "gp", "seat", ["boss"]),
      row("asst", "boss", "seat", ["asst"]),
    ];
    rows.find((r) => r.id === "gp-asst")!.isAssistant = true;
    rows.find((r) => r.id === "asst")!.isAssistant = true;
    const next = applyDelete(rows, "boss");
    expect(next.find((r) => r.id === "asst")!.isAssistant).toBe(false);
    expect(next.find((r) => r.id === "asst")!.parentId).toBe("gp");
  });
});
