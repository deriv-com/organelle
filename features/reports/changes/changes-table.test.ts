import { describe, expect, it } from "vitest";

import { formatChangeSentence, type ChangesTableRow } from "./changes-table";
import type { SeatSnapshot } from "./seat-snapshot";

function snap(overrides: Partial<SeatSnapshot> = {}): SeatSnapshot {
  return {
    nodeId: "n1",
    parentNodeId: "p",
    parentSeatId: "mgr",
    sortOrder: 0,
    jobTitle: "Engineer",
    memberAuthIds: ["a"],
    hostAuthId: "a",
    employeeId: "1",
    employmentRecord: "",
    fullName: "Test",
    email: "t@example.com",
    status: "active",
    managerEmail: "",
    managerName: "Boss",
    headerPathIds: [],
    dept: "Eng",
    teamLevels: ["Platform", "", "", "", "", "", ""],
    ...overrides,
  };
}

function row(overrides: Partial<ChangesTableRow>): ChangesTableRow {
  return {
    nodeId: "n1",
    changeType: "manager_change",
    changeTypeLabel: "Manager Change",
    before: snap({ managerName: "Alice" }),
    after: snap({ managerName: "Bob" }),
    actorName: "Editor",
    position: "Engineer · Eng",
    effectiveDate: "05/08/2026",
    ...overrides,
  };
}

describe("formatChangeSentence", () => {
  it("combines manager and team changes in one sentence", () => {
    const text = formatChangeSentence(
      row({
        before: snap({
          managerName: "Alice",
          dept: "Eng",
          teamLevels: ["A", "", "", "", "", "", ""],
        }),
        after: snap({
          managerName: "Bob",
          dept: "Sales",
          teamLevels: ["B", "", "", "", "", "", ""],
        }),
        changeType: "internal_movement",
      }),
    );
    expect(text).toContain("Manager changed from Alice to Bob");
    expect(text).toContain("team changed from Eng › A to Sales › B");
    expect(text.endsWith(".")).toBe(true);
  });

  it("describes new hires in one sentence", () => {
    expect(
      formatChangeSentence(
        row({
          changeType: "new_hire",
          changeTypeLabel: "New Hire",
          before: null,
          after: snap({
            managerName: "Boss",
            dept: "Eng",
            teamLevels: ["", "", "", "", "", "", ""],
          }),
        }),
      ),
    ).toBe("Joined under Boss in Eng.");
  });
});
