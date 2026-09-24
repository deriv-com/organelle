import { describe, expect, it } from "vitest";

import {
  commandFocusNodeId,
  reconstructStacks,
  representativeLogRow,
  type CommandSummary,
} from "./command-stack";

function cmd(
  commandId: string,
  kind: CommandSummary["kind"],
  undoesCommandId: string | null = null,
): CommandSummary {
  return { commandId, kind, undoesCommandId };
}

describe("reconstructStacks", () => {
  it("pushes user commands onto undo and clears redo", () => {
    const stacks = reconstructStacks([cmd("c1", "user"), cmd("c2", "user")]);
    expect(stacks.undo).toEqual(["c1", "c2"]);
    expect(stacks.redo).toEqual([]);
  });

  it("undo pops undo and pushes the user command onto redo", () => {
    const stacks = reconstructStacks([
      cmd("c1", "user"),
      cmd("c2", "user"),
      cmd("u2", "undo", "c2"),
    ]);
    expect(stacks.undo).toEqual(["c1"]);
    expect(stacks.redo).toEqual(["c2"]);
  });

  it("redo pops redo and pushes back onto undo", () => {
    const stacks = reconstructStacks([
      cmd("c1", "user"),
      cmd("c2", "user"),
      cmd("u2", "undo", "c2"),
      cmd("r2", "redo", "c2"),
    ]);
    expect(stacks.undo).toEqual(["c1", "c2"]);
    expect(stacks.redo).toEqual([]);
  });

  it("a new user command after undo clears redo", () => {
    const stacks = reconstructStacks([
      cmd("c1", "user"),
      cmd("c2", "user"),
      cmd("u2", "undo", "c2"),
      cmd("c3", "user"),
    ]);
    expect(stacks.undo).toEqual(["c1", "c3"]);
    expect(stacks.redo).toEqual([]);
  });

  it("skips nothing here — caller omits null command_id rows", () => {
    expect(reconstructStacks([])).toEqual({ undo: [], redo: [] });
  });
});

describe("commandFocusNodeId", () => {
  it("prefers a capstone op's node_id", () => {
    expect(
      commandFocusNodeId([
        {
          op: "unassign_employee",
          node_id: "src",
          employee_auth_id: "e",
          before: {},
          after: null,
        },
        {
          op: "create_seat",
          node_id: "new",
          employee_auth_id: "e",
          before: null,
          after: {},
        },
      ]),
    ).toBe("new");
  });
});

describe("representativeLogRow", () => {
  it("prefers delete over set_peer_host", () => {
    const row = representativeLogRow([
      {
        op: "set_peer_host",
        node_id: "s",
        employee_auth_id: "e",
        before: {},
        after: {},
      },
      {
        op: "delete_seat",
        node_id: "s",
        employee_auth_id: null,
        before: {},
        after: {},
      },
    ]);
    expect(row?.op).toBe("delete_seat");
  });
});
