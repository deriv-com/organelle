import { describe, expect, it } from "vitest";

import { type ChartRow, type SeatMember } from "@/features/chart/chart-row";
import {
  applyCreate,
  applyDelete,
  applyMemberMove,
  applyMove,
  applyMoveNodeOnly,
  applyPeer,
} from "@/features/chart/drag/apply";
import type { CommandLogRow } from "./command-stack";
import { applyCommand, invertCommand } from "./invert-command";

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
    name: kind === "header" ? id : undefined,
    jobTitle: kind === "seat" ? id : undefined,
    members: members.map((m, i) => member(m, i === 0)),
  };
}

function fixture() {
  seq = 0;
  return [
    row("root", "", "seat", ["publisher"]),
    row("p", "root", "header"),
    row("s1", "p", "seat", ["m1"]),
    row("s2", "p", "seat", ["m2"]),
    row("s3", "p", "seat", ["m3"]),
    row("q", "root", "header"),
    row("t1", "q", "seat", ["m4"]),
  ];
}

function shape(rows: ChartRow[]): string[] {
  return [...rows]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => `${r.id}:${r.parentId}:${r.members.map((m) => m.authId).join(",")}`);
}

function childrenOf(rows: ChartRow[], parentId: string): string[] {
  return rows
    .filter((r) => r.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => r.id);
}

describe("invertCommand", () => {
  it("round-trips applyMove", () => {
    const start = fixture();
    const node = start.find((r) => r.id === "s1")!;
    const log: CommandLogRow[] = [
      {
        op: "move_node",
        node_id: "s1",
        employee_auth_id: null,
        before: { parent_node_id: node.parentId, sort_order: 0 },
        after: { parent_node_id: "q", sort_order: 1 },
      },
    ];
    const moved = applyMove(start, {
      kind: "move",
      nodeId: "s1",
      newParentId: "q",
      beforeSiblingId: null,
    });
    const undone = invertCommand(moved, log);
    expect(shape(undone)).toEqual(shape(start));
    expect(childrenOf(undone, "p")).toEqual(["s1", "s2", "s3"]);
    expect(childrenOf(applyCommand(start, log), "q")).toEqual(childrenOf(moved, "q"));
  });

  it("round-trips applyMoveNodeOnly as one command of several move_node rows", () => {
    seq = 0;
    const start = [
      row("root", "", "seat", ["publisher"]),
      row("p", "root", "header"),
      row("mgr", "p", "seat", ["m1"]),
      row("c1", "mgr", "seat", ["k1"]),
      row("c2", "mgr", "seat", ["k2"]),
      row("q", "root", "header"),
    ];
    const drop = {
      kind: "move" as const,
      nodeId: "mgr",
      newParentId: "q",
      beforeSiblingId: null,
    };
    const moved = applyMoveNodeOnly(start, drop);
    const log: CommandLogRow[] = [
      {
        op: "move_node",
        node_id: "c1",
        employee_auth_id: null,
        before: { parent_node_id: "mgr", sort_order: 0 },
        after: { parent_node_id: "p", sort_order: 0 },
      },
      {
        op: "move_node",
        node_id: "c2",
        employee_auth_id: null,
        before: { parent_node_id: "mgr", sort_order: 1 },
        after: { parent_node_id: "p", sort_order: 1 },
      },
      {
        op: "move_node",
        node_id: "mgr",
        employee_auth_id: null,
        before: { parent_node_id: "p", sort_order: 0 },
        after: { parent_node_id: "q", sort_order: 0 },
      },
    ];
    const undone = invertCommand(moved, log);
    expect(shape(undone)).toEqual(shape(start));
    expect(childrenOf(undone, "mgr")).toEqual(["c1", "c2"]);
  });

  it("round-trips applyDelete", () => {
    const start = fixture();
    const node = start.find((r) => r.id === "s2")!;
    const log: CommandLogRow[] = [
      {
        op: "delete_seat",
        node_id: "s2",
        employee_auth_id: "m2",
        before: {
          parent_node_id: node.parentId,
          job_title: "s2",
          members: ["m2"],
          sort_order: 1,
        },
        after: { reparented: [] },
      },
    ];
    const deleted = applyDelete(start, "s2");
    const restored = invertCommand(deleted, log);
    expect(restored.some((r) => r.id === "s2")).toBe(true);
    expect(restored.find((r) => r.id === "s2")?.parentId).toBe("p");
    expect(restored.find((r) => r.id === "s2")?.members[0]?.authId).toBe("m2");
  });

  it("round-trips applyCreate", () => {
    const start = fixture();
    const log: CommandLogRow[] = [
      {
        op: "create_header",
        node_id: "new-team",
        employee_auth_id: null,
        before: null,
        after: { parent_node_id: "root", name: "New", sort_order: 2 },
      },
    ];
    const created = applyCreate(start, {
      kind: "header",
      nodeId: "new-team",
      parentId: "root",
      name: "New",
    });
    expect(invertCommand(created, log).some((r) => r.id === "new-team")).toBe(false);
  });

  it("round-trips applyPeer as one command", () => {
    const start = fixture();
    const source = start.find((r) => r.id === "s1")!;
    const log: CommandLogRow[] = [
      {
        op: "assign_employee",
        node_id: "s2",
        employee_auth_id: "m1",
        before: null,
        after: { is_host: false },
      },
      {
        op: "delete_seat",
        node_id: "s1",
        employee_auth_id: "m1",
        before: {
          parent_node_id: source.parentId,
          job_title: "s1",
          members: ["m1"],
          sort_order: 0,
        },
        after: { reparented: [] },
      },
    ];
    const joined = applyPeer(start, {
      kind: "peer",
      sourceSeatId: "s1",
      targetSeatId: "s2",
    });
    const undone = invertCommand(joined, log);
    expect(undone.some((r) => r.id === "s1")).toBe(true);
    expect(undone.find((r) => r.id === "s2")?.members.map((m) => m.authId)).toEqual([
      "m2",
    ]);
    expect(undone.find((r) => r.id === "s1")?.members.map((m) => m.authId)).toEqual([
      "m1",
    ]);
  });

  it("round-trips applyMemberMove peer join", () => {
    seq = 0;
    const start = [
      row("root", "", "seat", ["publisher"]),
      row("p", "root", "header"),
      row("s1", "p", "seat", ["m1", "m2"]),
      row("s2", "p", "seat", ["m3"]),
    ];
    const s1 = start.find((r) => r.id === "s1")!;
    s1.members = [member("m1", true), member("m2", false)];
    const log: CommandLogRow[] = [
      {
        op: "unassign_employee",
        node_id: "s1",
        employee_auth_id: "m2",
        before: { is_host: false },
        after: null,
      },
      {
        op: "assign_employee",
        node_id: "s2",
        employee_auth_id: "m2",
        before: null,
        after: { is_host: false },
      },
    ];
    const moved = applyMemberMove(start, {
      kind: "member-peer",
      sourceSeatId: "s1",
      authId: "m2",
      targetSeatId: "s2",
    });
    const undone = invertCommand(moved, log);
    expect(undone.find((r) => r.id === "s1")?.members.map((m) => m.authId)).toEqual([
      "m1",
      "m2",
    ]);
    expect(undone.find((r) => r.id === "s2")?.members.map((m) => m.authId)).toEqual([
      "m3",
    ]);
  });
});
