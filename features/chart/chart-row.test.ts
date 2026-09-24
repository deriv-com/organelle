import { describe, expect, it } from "vitest";

import {
  buildChart,
  ChartDataError,
  EDITOR_ONLY_MEMBER_KEYS,
  descendantEmployeeCount,
  directChildNodeCount,
  filterVisibleChartMembers,
  indexFromRows,
  orderRows,
  shouldMuteServingNotice,
  toPublicMember,
  uniqueEmployeeCount,
  type ChartRow,
} from "./chart-row";
import type { TreeQueryRow } from "./tree-query";

describe("shouldMuteServingNotice", () => {
  it.each([
    [4, true],
    [5, false],
    [6, false],
    [null, true],
  ])("applies the Level 5 exclusion for level %s", (positionLevel, expected) => {
    expect(shouldMuteServingNotice("serving_notice", positionLevel)).toBe(expected);
  });

  it("does not mute an active employee", () => {
    expect(shouldMuteServingNotice("active", 4)).toBe(false);
  });
});

let seq = 0;
function nodeId(): string {
  seq += 1;
  return `n${seq}`;
}

function makeNode(
  overrides: Partial<TreeQueryRow> & { node_id: string },
): TreeQueryRow {
  return {
    parent_node_id: null,
    node_type: "seat",
    sort_order: 0,
    row_version: 1,
    name: null,
    job_title: null,
    position_level: null,
    is_assistant: false,
    leaf_grid_columns: 3,
    employee_auth_id: null,
    is_host: null,
    full_name: null,
    email: null,
    employee_job_title: null,
    employee_avatar_url: null,
    office_location: null,
    status: null,
    joining_date: null,
    override_display_name: null,
    override_display_title: null,
    override_avatar_url: null,
    ...overrides,
  };
}

function makeMember(
  node: string,
  parent: string,
  overrides: Partial<TreeQueryRow>,
): TreeQueryRow {
  return makeNode({
    node_id: node,
    parent_node_id: parent,
    node_type: "seat",
    employee_auth_id: "emp-1",
    is_host: true,
    full_name: "Jane Doe",
    employee_job_title: "Engineer",
    status: "active",
    ...overrides,
  });
}

describe("buildChart", () => {
  it("builds rows with host-first members and spec-shaped fields", () => {
    const root = nodeId();
    const seat = nodeId();
    const { rows, index } = buildChart([
      makeMember(root, "", { full_name: "Publisher", is_host: true }),
      makeNode({
        node_id: seat,
        parent_node_id: root,
        employee_auth_id: "a",
        is_host: true,
        full_name: "Host",
        status: "active",
      }),
      makeNode({
        node_id: seat,
        parent_node_id: root,
        employee_auth_id: "b",
        is_host: false,
        full_name: "Peer",
        status: "joining",
      }),
    ]);
    expect(index.rootId).toBe(root);
    const peerRow = rows.find((r) => r.id === seat)!;
    expect(peerRow.members.map((m) => m.displayName)).toEqual(["Host", "Peer"]);
    expect(peerRow.members[0]!.isHost).toBe(true);
    expect(peerRow.members[1]!.status).toBe("joining");
  });

  it("filters inactive and resigned members from chart rows while keeping serving notice", () => {
    const root = nodeId();
    const seat = nodeId();
    const { rows } = buildChart([
      makeMember(root, "", { full_name: "Publisher", is_host: true }),
      makeNode({
        node_id: seat,
        parent_node_id: root,
        employee_auth_id: "a",
        is_host: true,
        full_name: "Visible",
        status: "active",
      }),
      makeNode({
        node_id: seat,
        parent_node_id: root,
        employee_auth_id: "n",
        is_host: false,
        full_name: "Notice",
        status: "serving_notice",
      }),
      makeNode({
        node_id: seat,
        parent_node_id: root,
        employee_auth_id: "b",
        is_host: false,
        full_name: "Inactive",
        status: "inactive",
      }),
      makeNode({
        node_id: seat,
        parent_node_id: root,
        employee_auth_id: "c",
        is_host: false,
        full_name: "Former",
        status: "resigned",
      }),
    ]);
    expect(rows.find((r) => r.id === seat)!.members.map((m) => m.displayName)).toEqual([
      "Visible",
      "Notice",
    ]);
  });

  it("keeps a seat row vacant when all assigned members are inactive or resigned", () => {
    const root = nodeId();
    const seat = nodeId();
    const { rows } = buildChart([
      makeMember(root, "", { full_name: "Publisher", is_host: true }),
      makeNode({
        node_id: seat,
        parent_node_id: root,
        employee_auth_id: "inactive",
        is_host: true,
        full_name: "Inactive",
        status: "inactive",
      }),
      makeNode({
        node_id: seat,
        parent_node_id: root,
        employee_auth_id: "former",
        is_host: false,
        full_name: "Former",
        status: "resigned",
      }),
    ]);
    expect(rows.find((r) => r.id === seat)).toMatchObject({ id: seat, members: [] });
  });

  it("filters members whose resolved override status is inactive or resigned", () => {
    const root = nodeId();
    const inactiveSeat = nodeId();
    const resignedSeat = nodeId();
    const { rows } = buildChart([
      makeMember(root, "", { full_name: "Publisher", is_host: true }),
      makeNode({
        node_id: inactiveSeat,
        parent_node_id: root,
        employee_auth_id: "inactive",
        is_host: true,
        full_name: "Inactive",
        status: "active",
        override_auth_id: "inactive",
        override_status: "inactive",
      }),
      makeNode({
        node_id: resignedSeat,
        parent_node_id: root,
        employee_auth_id: "former",
        is_host: true,
        full_name: "Former",
        status: "active",
        override_auth_id: "former",
        override_status: "resigned",
      }),
    ]);
    expect(rows.find((r) => r.id === inactiveSeat)!.members).toEqual([]);
    expect(rows.find((r) => r.id === resignedSeat)!.members).toEqual([]);
  });

  it("filters inactive and resigned members from already-built chart rows", () => {
    const root = nodeId();
    const seat = nodeId();
    const rows: ChartRow[] = [
      {
        id: root,
        parentId: "",
        kind: "seat",
        sortOrder: 0,
        rowVersion: 1,
        members: [
          {
            authId: "publisher",
            displayName: "Publisher",
            displayTitle: "",
            email: "publisher@example.com",
            avatarUrl: null,
            officeLocation: "",
            status: "active",
            joiningDate: null,
            isHost: true,
            sourceName: "Publisher",
            sourceTitle: "",
            sourceAvatarUrl: null,
            overrideName: null,
            overrideTitle: null,
            overrideAvatarUrl: null,
          },
        ],
      },
      {
        id: seat,
        parentId: root,
        kind: "seat",
        sortOrder: 1,
        rowVersion: 1,
        members: [
          {
            authId: "former",
            displayName: "Former Employee",
            displayTitle: "",
            email: "former@example.com",
            avatarUrl: null,
            officeLocation: "",
            status: "resigned",
            joiningDate: null,
            isHost: true,
            sourceName: "Former Employee",
            sourceTitle: "",
            sourceAvatarUrl: null,
            overrideName: null,
            overrideTitle: null,
            overrideAvatarUrl: null,
          },
        ],
      },
    ];

    expect(
      filterVisibleChartMembers(rows).find((row) => row.id === seat),
    ).toMatchObject({
      members: [],
    });
  });

  it("maps is_primary onto members", () => {
    const root = nodeId();
    const { rows } = buildChart([
      makeMember(root, "", {
        full_name: "Pat",
        is_host: true,
        is_primary: true,
      }),
    ]);
    expect(rows[0]!.members[0]).toMatchObject({
      isPrimary: true,
    });
  });

  it("resolves display fields from a scoped employee override row", () => {
    const root = nodeId();
    const { rows } = buildChart([
      makeMember(root, "", {
        full_name: "Source Name",
        employee_job_title: "Source Title",
        employee_avatar_url: "source.png",
        override_auth_id: "emp-1",
        override_display_name: "Preferred",
        override_display_title: "Source Title",
        override_avatar_url: "override.png",
      }),
    ]);
    const member = rows[0]!.members[0]!;
    expect(member.displayName).toBe("Preferred");
    expect(member.displayTitle).toBe("Source Title");
    expect(member.avatarUrl).toBe("override.png");
    expect(member.sourceName).toBe("Source Name");
    expect(member.overrideName).toBe("Preferred");
    expect(member.overrideAvatarUrl).toBe("override.png");
  });

  it("propagates the top-level header as the dept colour key", () => {
    const root = nodeId();
    const header = nodeId();
    const seat = nodeId();
    const direct = nodeId();
    const { index } = buildChart([
      makeMember(root, "", {}),
      makeNode({
        node_id: header,
        parent_node_id: root,
        node_type: "header",
        name: "Engineering",
      }),
      makeMember(seat, header, {}),
      makeMember(direct, root, {}),
    ]);
    expect(index.deptById.get(seat)).toBe(header);
    expect(index.deptById.get(header)).toBe(header);
    expect(index.deptById.get(direct)).toBeNull(); // reports straight to root
    expect(index.deptById.get(root)).toBeNull();
    expect(index.deptColorById.get(seat)).toBe(index.deptColorById.get(header));
    expect(index.deptColorById.has(root)).toBe(false);
    expect(index.depthById.get(seat)).toBe(3);
  });

  it("assigns distinct colours to two department headers", () => {
    const root = nodeId();
    const eng = nodeId();
    const fin = nodeId();
    const { index } = buildChart([
      makeMember(root, "", {}),
      makeNode({
        node_id: eng,
        parent_node_id: root,
        node_type: "header",
        name: "Engineering",
      }),
      makeNode({
        node_id: fin,
        parent_node_id: root,
        node_type: "header",
        name: "Finance",
      }),
    ]);
    expect(index.deptColorById.get(eng)).not.toBe(index.deptColorById.get(fin));
  });

  it("keeps the family colour when the department header is renamed", () => {
    const root = nodeId();
    const header = nodeId();
    const seat = nodeId();
    const members = { full_name: "A", is_host: true, status: "active" as const };
    const first = buildChart([
      makeMember(root, "", {}),
      makeNode({
        node_id: header,
        parent_node_id: root,
        node_type: "header",
        name: "Engineering",
      }),
      makeMember(seat, header, members),
    ]);
    const renamed = buildChart([
      makeMember(root, "", {}),
      makeNode({
        node_id: header,
        parent_node_id: root,
        node_type: "header",
        name: "Eng",
      }),
      makeMember(seat, header, members),
    ]);
    expect(renamed.index.deptById.get(seat)).toBe(header);
    expect(renamed.index.deptColorById.get(seat)).toBe(
      first.index.deptColorById.get(seat),
    );
  });

  it("emits rows in DFS pre-order following sortOrder", () => {
    const root = nodeId();
    const h1 = nodeId();
    const h2 = nodeId();
    const seatA = nodeId();
    const seatB = nodeId();
    const direct = nodeId();
    const { rows } = buildChart([
      // Deliberately shuffled input order (the SQL orders by random UUIDs).
      makeMember(seatA, h1, { sort_order: 1 }),
      makeNode({
        node_id: h1,
        parent_node_id: root,
        node_type: "header",
        name: "B-Dept",
        sort_order: 2,
      }),
      makeMember(direct, root, { sort_order: 3 }),
      makeMember(root, "", { sort_order: 0 }),
      makeMember(seatB, h1, { sort_order: 0 }),
      makeNode({
        node_id: h2,
        parent_node_id: root,
        node_type: "header",
        name: "A-Dept",
        sort_order: 1,
      }),
    ]);
    // DFS pre-order: root, then h2 (sort 1), then h1 (sort 2) with seatB
    // (sort 0) before seatA (sort 1), then direct (sort 3). d3 stratify
    // preserves this array order, so this is the on-screen sibling order.
    expect(rows.map((r) => r.id)).toEqual([root, h2, h1, seatB, seatA, direct]);
  });

  it("throws on a dangling parent instead of pruning it", () => {
    const root = nodeId();
    expect(() =>
      buildChart([
        makeMember(root, "", {}),
        makeMember(nodeId(), "missing-parent", {}),
      ]),
    ).toThrow(ChartDataError);
  });

  it("throws on a second root", () => {
    expect(() =>
      buildChart([makeMember(nodeId(), "", {}), makeMember(nodeId(), "", {})]),
    ).toThrow(/exactly one root/);
  });

  it("throws on nodes unreachable from the root (orphan/cycle)", () => {
    const root = nodeId();
    const a = nodeId();
    const b = nodeId();
    expect(() =>
      buildChart([
        makeMember(root, "", {}),
        makeMember(a, b, {}), // a <-> b cycle, detached from root
        makeMember(b, a, {}),
      ]),
    ).toThrow(/unreachable/);
  });
});

describe("orderRows", () => {
  it("re-emits shuffled siblings in DFS pre-order following sortOrder", () => {
    const row = (
      id: string,
      parentId: string,
      sortOrder: number,
      kind: ChartRow["kind"] = "seat",
    ): ChartRow => ({
      id,
      parentId,
      kind,
      sortOrder,
      rowVersion: 1,
      members: [],
    });
    const shuffled = [
      row("seatA", "h1", 1),
      row("h1", "root", 2, "header"),
      row("direct", "root", 3),
      row("root", "", 0),
      row("seatB", "h1", 0),
      row("h2", "root", 1, "header"),
    ];
    expect(orderRows(shuffled).map((r) => r.id)).toEqual([
      "root",
      "h2",
      "h1",
      "seatB",
      "seatA",
      "direct",
    ]);
  });
});

describe("descendantEmployeeCount", () => {
  const member = (authId: string): ChartRow["members"][number] => ({
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
  });

  const row = (
    id: string,
    parentId: string,
    kind: ChartRow["kind"],
    extra: Partial<ChartRow> = {},
  ): ChartRow => ({
    id,
    parentId,
    kind,
    sortOrder: 0,
    rowVersion: 1,
    members: [],
    ...extra,
  });

  it("counts unique employee descendants and skips headers", () => {
    const rows = [
      row("opt", "", "header"),
      row("vivian", "opt", "seat", { members: [member("vivian")] }),
      row("automations", "vivian", "header"),
      row("mahesh", "automations", "seat", { members: [member("mahesh")] }),
      row("kai", "mahesh", "seat", { members: [member("kai")] }),
      row("ming", "kai", "seat", { members: [member("ming")] }),
      row("naga", "mahesh", "seat", { members: [member("naga")] }),
      row("abdul", "mahesh", "seat", { members: [member("abdul")] }),
    ];
    const index = indexFromRows(rows);
    expect(descendantEmployeeCount(index, "opt")).toBe(6);
    expect(descendantEmployeeCount(index, "vivian")).toBe(5);
    expect(descendantEmployeeCount(index, "automations")).toBe(5);
    expect(descendantEmployeeCount(index, "ming")).toBe(0);
  });

  it("dedupes multi-role descendants while counting peers and assistants", () => {
    const rows = [
      row("parent", "", "seat", { members: [member("manager")] }),
      row("role-a", "parent", "seat", { members: [member("multi-role")] }),
      row("peer", "role-a", "seat", {
        members: [member("peer-a"), member("peer-b")],
      }),
      row("asst", "parent", "seat", {
        isAssistant: true,
        members: [member("assistant")],
      }),
      row("role-b", "parent", "seat", { members: [member("multi-role")] }),
      row("vacant", "parent", "seat"),
      row("header", "parent", "header"),
    ];
    expect(descendantEmployeeCount(indexFromRows(rows), "parent")).toBe(4);
  });

  it("counts every direct child node for the next-level chip", () => {
    const rows = [
      row("parent", "", "seat", { members: [member("manager")] }),
      row("role-a", "parent", "seat", { members: [member("multi-role")] }),
      row("role-b", "parent", "seat", { members: [member("multi-role")] }),
      row("peer", "parent", "seat", {
        members: [member("peer-a"), member("peer-b")],
      }),
      row("asst", "parent", "seat", {
        isAssistant: true,
        members: [member("assistant")],
      }),
      row("vacant", "parent", "seat"),
      row("header", "parent", "header"),
    ];

    expect(directChildNodeCount(indexFromRows(rows), "parent")).toBe(6);
  });

  it("counts direct header and seat nodes for the next-level chip", () => {
    const rows = [
      row("waqas", "", "seat", { members: [member("waqas")] }),
      row("ai-product", "waqas", "header"),
      row("cre8", "waqas", "header"),
      row("digital-marketing", "waqas", "header"),
    ];

    expect(directChildNodeCount(indexFromRows(rows), "waqas")).toBe(3);
  });

  it("counts total employees once across multiple roles", () => {
    const rows = [
      row("root", "", "seat", { members: [member("publisher")] }),
      row("role-a", "root", "seat", { members: [member("multi-role")] }),
      row("role-b", "root", "seat", { members: [member("multi-role")] }),
      row("peer", "root", "seat", {
        members: [member("peer-a"), member("peer-b")],
      }),
      row("vacant", "root", "seat"),
      row("header", "root", "header"),
    ];

    expect(uniqueEmployeeCount(rows)).toBe(4);
  });
});

describe("toPublicMember", () => {
  it("omits titles, source provenance, and source directory columns", () => {
    const { rows } = buildChart([
      makeMember("seat", "root", {
        parent_node_id: "root",
        full_name: "Amy",
        legal_full_name: "Amy Legal",
        employment_record: "2024.01 #1",
        resignation_date: "2026-12-31",
      }),
      makeMember("root", "", { full_name: "Publisher" }),
    ]);
    const member = rows[1]?.members[0];
    expect(member?.legalFullName).toBe("Amy Legal");

    const pub = toPublicMember(member!);
    expect(pub.displayName).toBe("Amy");
    for (const key of EDITOR_ONLY_MEMBER_KEYS) {
      expect(pub).not.toHaveProperty(key);
    }
  });
});
