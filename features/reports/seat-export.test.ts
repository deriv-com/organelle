import { describe, expect, it } from "vitest";

import type { ChartRow, SeatMember } from "../chart/chart-row";
import {
  buildSeatExportRows,
  formatSeatExportCsv,
  seatExportRowToCells,
} from "./seat-export";

const member = (authId: string, name: string, isHost = true): SeatMember => ({
  authId,
  employeeId: authId.toUpperCase(),
  displayName: name,
  displayTitle: "Engineer",
  email: `${authId}@example.com`,
  avatarUrl: null,
  officeLocation: "Remote",
  officeCountry: "Global",
  status: "active",
  joiningDate: null,
  isHost,
  isPrimary: true,
  sourceName: name,
  sourceTitle: "Engineer",
  sourceAvatarUrl: null,
  overrideName: null,
  overrideTitle: null,
  overrideAvatarUrl: null,
});

describe("seat export", () => {
  it("exports one row per employee-seat assignment", () => {
    const rows: ChartRow[] = [
      {
        id: "root",
        parentId: "",
        kind: "header",
        sortOrder: 0,
        rowVersion: 1,
        name: "Engineering",
        members: [],
      },
      {
        id: "seat",
        parentId: "root",
        kind: "seat",
        sortOrder: 0,
        rowVersion: 1,
        jobTitle: "Engineer",
        members: [member("a", "Alex"), member("b", "Bailey", false)],
      },
    ];
    const exported = buildSeatExportRows(rows);
    expect(exported).toHaveLength(2);
    expect(exported.map((row) => row.seatId)).toEqual(["seat", "seat"]);
    expect(seatExportRowToCells(exported[0]!)).toHaveLength(15);
    expect(formatSeatExportCsv(exported).split("\n")[0]).toContain("organization_path");
  });
});
