import { describe, expect, it } from "vitest";

import {
  cleanImportRow,
  topologicalImportRows,
  validateImportRows,
  type ImportRow,
} from "./validation";

const row = (
  id: string,
  manager = "",
  overrides: Partial<ImportRow> = {},
): ImportRow => ({
  employee_id: id,
  email: `${id.toLowerCase()}@example.com`,
  full_name: `Person ${id}`,
  manager_employee_id: manager,
  job_title: "Engineer",
  position_level: "3",
  org_path: "Engineering > Platform",
  status: "active",
  office_location: "Remote",
  office_country: "",
  avatar_url: "",
  ...overrides,
});

describe("directory import validation", () => {
  it("normalizes input and defaults status", () => {
    expect(
      cleanImportRow({ employee_id: " A ", email: " ADA@EXAMPLE.COM " }).email,
    ).toBe("ada@example.com");
    expect(cleanImportRow({ employee_id: "A", email: "a@example.com" }).status).toBe(
      "active",
    );
  });

  it("orders managers before reports deterministically", () => {
    const ordered = topologicalImportRows([row("C", "A"), row("B", "A"), row("A")]);
    expect(ordered.map((item) => item.employee_id)).toEqual(["A", "B", "C"]);
  });

  it.each([
    [[row("A"), row("A", "", { email: "other@example.com" })], "duplicate employee_id"],
    [[row("A"), row("B", "", { email: "a@example.com" })], "duplicate email"],
    [[row("A", "MISSING")], "Unknown manager"],
    [[row("A", "B"), row("B", "A")], "Manager cycle"],
    [[row("A", "", { status: "unknown" })], "invalid status"],
    [[row("A", "", { org_path: Array(13).fill("Unit").join(" > ") })], "too deep"],
  ])("rejects invalid input transaction preconditions", (rows, message) => {
    expect(() => validateImportRows(rows as ImportRow[])).toThrow(String(message));
  });
});
