import { describe, expect, it } from "vitest";

import type { ChartRow, SeatMember } from "@/features/chart/chart-row";
import { groupByDay, historyBlock, historyBlocks } from "./history-block";
import type { HistoryRow } from "./history-block";

function member(authId: string, name: string): SeatMember {
  return {
    authId,
    displayName: name,
    displayTitle: "Eng",
    email: `${authId}@example.com`,
    avatarUrl: null,
    officeLocation: "Dubai",
    status: "active",
    joiningDate: null,
    isHost: true,
    sourceName: name,
    sourceTitle: "Eng",
    sourceAvatarUrl: null,
    overrideName: null,
    overrideTitle: null,
    overrideAvatarUrl: null,
  };
}

const rows: ChartRow[] = [
  {
    id: "root",
    parentId: "",
    kind: "seat",
    sortOrder: 0,
    rowVersion: 1,
    members: [member("publisher", "Chief")],
  },
  {
    id: "eng",
    parentId: "root",
    kind: "header",
    sortOrder: 0,
    rowVersion: 1,
    name: "Engineering",
    members: [],
  },
  {
    id: "seat-a",
    parentId: "eng",
    kind: "seat",
    sortOrder: 0,
    rowVersion: 1,
    jobTitle: "Engineer",
    members: [member("amy", "Amy")],
  },
];

function entry(partial: Partial<HistoryRow> & Pick<HistoryRow, "op">): HistoryRow {
  return {
    id: partial.id ?? "1",
    op: partial.op,
    node_id: partial.node_id ?? "seat-a",
    employee_auth_id: partial.employee_auth_id ?? null,
    before: partial.before ?? null,
    after: partial.after ?? {},
    created_at: partial.created_at ?? "2026-08-20T06:32:00.000Z",
    command_id: partial.command_id ?? null,
    command_kind: partial.command_kind ?? null,
    undoes_command_id: partial.undoes_command_id ?? null,
    actor_name: partial.actor_name ?? null,
  };
}

describe("historyBlock", () => {
  it("describes a move with subject and destination chips", () => {
    const block = historyBlock(
      entry({
        op: "move_node",
        after: { parent_node_id: "eng" },
      }),
      rows,
    );
    expect(block.kind).toBe("Move");
    expect(block.action).toBe("Moved");
    expect(block.subject[0]).toMatchObject({ type: "person", name: "Amy" });
    expect(block.details).toEqual([
      expect.objectContaining({ label: "From" }),
      expect.objectContaining({
        label: "To",
        chips: [
          expect.objectContaining({ type: "team", name: "Engineering", dept: "eng" }),
        ],
      }),
    ]);
  });

  it("describes a team create", () => {
    const block = historyBlock(
      entry({
        op: "create_header",
        node_id: "eng",
        after: { parent_node_id: "eng" },
      }),
      rows,
    );
    expect(block.kind).toBe("Team created");
  });

  it("describes a seat delete with children moved up and person name", () => {
    const block = historyBlock(
      entry({
        op: "delete_seat",
        employee_name: "Amy",
        before: { job_title: "Engineer", members: ["amy"] },
        after: { reparented: ["child-1"] },
      }),
      rows,
    );
    expect(block.kind).toBe("Removed");
    expect(block.subject[0]).toMatchObject({
      type: "person",
      name: "Amy",
    });
    expect(block.details[1]).toMatchObject({
      label: "Children",
      text: "1 child moved up",
    });
  });

  it("describes a team rename with before and after names", () => {
    const block = historyBlock(
      entry({
        op: "rename_header",
        node_id: "eng",
        before: { name: "Old Team" },
        after: { name: "New Team" },
      }),
      rows,
    );
    expect(block.kind).toBe("Renamed");
    expect(block.action).toBe("Renamed team");
    expect(block.subject[0]).toMatchObject({
      type: "team",
      name: "New Team",
    });
    expect(block.details[0]).toMatchObject({
      label: "Name",
      text: "Old Team → New Team",
    });
  });

  it("describes an employee update without falling back to a removed node", () => {
    const block = historyBlock(
      entry({
        op: "update_employee",
        node_id: null,
        employee_auth_id: "amy",
        employee_name: "Amy Pond",
        before: { full_name: "Amy" },
        after: { full_name: "Amy Pond" },
      }),
      rows,
    );
    expect(block.kind).toBe("Employee updated");
    expect(block.action).toBe("Updated employee");
    expect(block.subject[0]).toMatchObject({ type: "person", name: "Amy Pond" });
    expect(block.details[0]).toMatchObject({
      label: "Full name",
      text: "Amy → Amy Pond",
    });
  });

  it("keeps multi-field employee update details under the main title", () => {
    const block = historyBlock(
      entry({
        op: "update_employee",
        node_id: null,
        employee_auth_id: "amy",
        employee_name: "Amy Pond",
        before: { email: "amy@example.com", full_name: "Amy" },
        after: { email: "pond@example.com", full_name: "Amy Pond" },
      }),
      rows,
    );
    expect(block.action).toBe("Updated employee");
    expect(block.details).toEqual([
      expect.objectContaining({
        label: "Email",
        text: "amy@example.com → pond@example.com",
      }),
      expect.objectContaining({ label: "Full name", text: "Amy → Amy Pond" }),
    ]);
  });

  it("formats snake_case update values for display", () => {
    const block = historyBlock(
      entry({
        op: "update_employee",
        node_id: null,
        employee_auth_id: "amy",
        employee_name: "Amy",
        before: { status: "serving_notice" },
        after: { status: "active" },
      }),
      rows,
    );
    expect(block.details[0]).toMatchObject({
      label: "Status",
      text: "Serving Notice → Active",
    });
  });

  it("omits fallback copy for older employee updates without usable field data", () => {
    const block = historyBlock(
      entry({
        op: "update_employee",
        node_id: null,
        employee_auth_id: "amy",
        employee_name: "Amy",
      }),
      rows,
    );
    expect(block.action).toBe("Updated employee");
    expect(block.details).toEqual([]);
  });

  it("uses field tags for older employee updates with field names but no exact values", () => {
    const block = historyBlock(
      entry({
        op: "update_employee",
        node_id: null,
        employee_auth_id: "amy",
        employee_name: "Amy",
        before: { full_name: "Amy" },
        after: { full_name: "Amy" },
      }),
      rows,
    );
    expect(block.action).toBe("Updated employee");
    expect(block.details[0]).toMatchObject({ label: "", tags: ["Full name"] });
  });

  it("describes a position rename as a labeled field diff", () => {
    const block = historyBlock(
      entry({
        op: "rename_seat",
        before: { job_title: "Engineer" },
        after: { job_title: "Senior Engineer" },
      }),
      rows,
    );
    expect(block.action).toBe("Renamed position");
    expect(block.details[0]).toMatchObject({
      label: "Job title",
      text: "Engineer → Senior Engineer",
    });
  });
});

describe("historyBlocks", () => {
  it("groups rows that share a command_id into one block", () => {
    const blocks = historyBlocks(
      [
        entry({
          id: "2",
          op: "delete_seat",
          command_id: "cmd-1",
          command_kind: "user",
        }),
        entry({
          id: "1",
          op: "assign_employee",
          command_id: "cmd-1",
          command_kind: "user",
          employee_auth_id: "amy",
        }),
      ],
      rows,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("Removed");
  });

  it("keeps the command actor separate from the target subject", () => {
    const blocks = historyBlocks(
      [
        entry({
          id: "2",
          op: "move_node",
          command_id: "cmd-1",
          command_kind: "user",
          actor_name: "Admin User",
          after: { parent_node_id: "eng" },
        }),
        entry({
          id: "1",
          op: "assign_employee",
          command_id: "cmd-1",
          command_kind: "user",
          employee_auth_id: "amy",
          actor_name: "Admin User",
        }),
      ],
      rows,
    );
    expect(blocks[0]!.actorName).toBe("Admin User");
    expect(blocks[0]!.subject[0]).toMatchObject({ type: "person", name: "Amy" });
  });

  it("labels undo commands Undid using the original user action", () => {
    const blocks = historyBlocks(
      [
        entry({
          id: "3",
          op: "create_seat",
          command_id: "u1",
          command_kind: "undo",
          undoes_command_id: "c1",
        }),
        entry({
          id: "2",
          op: "delete_seat",
          command_id: "c1",
          command_kind: "user",
        }),
      ],
      rows,
    );
    expect(blocks[0]!.kind).toBe("Undid");
    expect(blocks[0]!.op).toBe("delete_seat");
  });

  it("keeps ungrouped pre-feature rows as one block each", () => {
    const blocks = historyBlocks(
      [entry({ id: "a", op: "move_node" }), entry({ id: "b", op: "rename_header" })],
      rows,
    );
    expect(blocks).toHaveLength(2);
  });
});

describe("groupByDay", () => {
  it("groups consecutive same-day blocks", () => {
    const a = historyBlock(entry({ op: "reorder_node" }), rows);
    const b = historyBlock(entry({ op: "reorder_node", id: "2" }), rows);
    const groups = groupByDay([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(2);
  });
});
