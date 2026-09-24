import { describe, expect, it } from "vitest";

import {
  mapPickerRows,
  toEmployeeOption,
  type PickerEmployeeRow,
} from "./employee-picker";

function row(
  overrides: Partial<PickerEmployeeRow> & Pick<PickerEmployeeRow, "auth_id">,
): PickerEmployeeRow {
  return {
    full_name: "Morgan Fixture",
    email: "morgan@example.com",
    job_title: "Engineer",
    avatar_url: null,
    office_location: "Dubai",
    status: "active",
    joining_date: null,
    position_level: null,
    override_auth_id: null,
    display_name: null,
    display_title: null,
    override_avatar_url: null,
    override_status: null,
    override_position_level: null,
    ...overrides,
  };
}

describe("mapPickerRows", () => {
  it("includes an employee who is not on any seat", () => {
    const members = mapPickerRows([row({ auth_id: "unplaced" })]);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      authId: "unplaced",
      displayName: "Morgan Fixture",
      displayTitle: "Engineer",
      status: "active",
      isHost: true,
    });
  });

  it("prefers override display name and title", () => {
    const [member] = mapPickerRows([
      row({
        auth_id: "a",
        display_name: "Morgan F.",
        display_title: "Staff Engineer",
      }),
    ]);
    expect(member!.displayName).toBe("Morgan F.");
    expect(member!.displayTitle).toBe("Staff Engineer");
    expect(member!.sourceName).toBe("Morgan Fixture");
    expect(member!.sourceTitle).toBe("Engineer");
    expect(member!.overrideName).toBe("Morgan F.");
    expect(member!.overrideTitle).toBe("Staff Engineer");
  });

  it("preserves joining status", () => {
    const [member] = mapPickerRows([
      row({ auth_id: "j", status: "joining", joining_date: "2026-09-21" }),
    ]);
    expect(member!.status).toBe("joining");
    expect(member!.joiningDate).toBe("2026-09-21");
  });

  it("uses override status and level together for serving-notice styling", () => {
    const [member] = mapPickerRows([
      row({
        auth_id: "notice",
        status: "active",
        position_level: 4,
        override_auth_id: "notice",
        override_status: "serving_notice",
        override_position_level: 5,
      }),
    ]);
    expect(member!.status).toBe("serving_notice");
    expect(member!.positionLevel).toBe(5);
    expect(member!.servingNoticeMuted).toBe(false);
  });

  it("preserves an explicit null level from an employee override", () => {
    const [member] = mapPickerRows([
      row({
        auth_id: "notice",
        status: "serving_notice",
        position_level: 5,
        override_auth_id: "notice",
        override_status: "serving_notice",
        override_position_level: null,
      }),
    ]);
    expect(member!.positionLevel).toBeNull();
    expect(member!.servingNoticeMuted).toBe(true);
  });

  it("keeps inactive and resigned people available for reactivation", () => {
    const members = mapPickerRows([
      row({ auth_id: "active", status: "active" }),
      row({ auth_id: "inactive", status: "inactive" }),
      row({ auth_id: "resigned", status: "resigned" }),
    ]);

    expect(members.map((member) => member.authId)).toEqual([
      "active",
      "inactive",
      "resigned",
    ]);
  });

  it("includes a newly created person-shaped row", () => {
    const [member] = mapPickerRows([
      row({ auth_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", full_name: "Pat New" }),
    ]);
    expect(member!.authId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(member!.displayName).toBe("Pat New");
  });

  it("sorts by display name", () => {
    const members = mapPickerRows([
      row({ auth_id: "b", full_name: "Zed" }),
      row({ auth_id: "a", full_name: "Amy", display_name: "Amy A" }),
    ]);
    expect(members.map((m) => m.authId)).toEqual(["a", "b"]);
  });
});

describe("toEmployeeOption", () => {
  it("maps catalog members for the dialog list", () => {
    const [member] = mapPickerRows([row({ auth_id: "a" })]);
    expect(toEmployeeOption(member!)).toEqual({
      authId: "a",
      displayName: "Morgan Fixture",
      displayTitle: "Engineer",
      status: "active",
    });
  });
});
