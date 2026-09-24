import { describe, expect, it } from "vitest";

import {
  addSeatCanConfirm,
  createPersonCanConfirm,
  draftFromMember,
  emptyDraft,
  employeeDraftsEqual,
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUSES,
  isValidReactivationDate,
  localEmployeeInsert,
  memberPatchFromDraft,
  resolveEmployeeLifecycleStatus,
  resolveSeatTitle,
  validateCreatePerson,
  validateEmployeeDraft,
} from "./employee-fields";
import type { SeatMember } from "@/features/chart/chart-row";

function validDraft() {
  return {
    ...emptyDraft(),
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    jobTitle: "Engineer",
  };
}

describe("validateCreatePerson", () => {
  it("requires an ISO date when reactivating an employee", () => {
    expect(isValidReactivationDate("2026-09-04")).toBe(true);
    expect(isValidReactivationDate("04/09/2026")).toBe(false);
    expect(isValidReactivationDate("")).toBe(false);
  });

  it("requires name, email, and a seat title", () => {
    expect(validateCreatePerson(emptyDraft(), "")).toMatchObject({
      fullName: expect.any(String),
      email: expect.any(String),
      seatTitle: expect.any(String),
    });
  });

  it("accepts a valid create payload", () => {
    expect(validateCreatePerson(validDraft(), "Staff Engineer")).toEqual({});
  });

  it("allows joining people without an email", () => {
    expect(
      validateCreatePerson(
        { ...validDraft(), status: "joining", email: "" },
        "Staff Engineer",
      ),
    ).toEqual({});
  });

  it("still rejects invalid typed emails for joining people", () => {
    expect(
      validateCreatePerson(
        { ...validDraft(), status: "joining", email: "not-email" },
        "Staff Engineer",
      ),
    ).toMatchObject({
      email: expect.any(String),
    });
  });

  it("prefills seat title from the person title when the seat field is empty", () => {
    expect(resolveSeatTitle("", "Staff Engineer")).toBe("Staff Engineer");
    expect(validateCreatePerson(validDraft(), "")).toEqual({});
  });

  it("rejects a javascript avatar URL", () => {
    const errors = validateCreatePerson(
      { ...validDraft(), avatarUrl: "javascript:alert(1)" },
      "Engineer",
    );
    expect(errors.avatarUrl).toBeDefined();
  });
});

describe("confirm gates", () => {
  it("disables add-seat confirm until an employee and title are set", () => {
    expect(addSeatCanConfirm(null, "Engineer")).toBe(false);
    expect(addSeatCanConfirm("emp-1", "")).toBe(false);
    expect(addSeatCanConfirm("emp-1", "Engineer")).toBe(true);
    expect(addSeatCanConfirm("emp-1", "Engineer", true)).toBe(false);
  });

  it("disables create-person confirm until name, email, and seat title are valid", () => {
    expect(createPersonCanConfirm(emptyDraft(), "")).toBe(false);
    expect(createPersonCanConfirm(validDraft(), "Engineer")).toBe(true);
    expect(createPersonCanConfirm(validDraft(), "Engineer", true)).toBe(false);
  });
});

describe("employeeDraftsEqual", () => {
  it("returns true when draft fields are unchanged", () => {
    const draft = validDraft();
    expect(employeeDraftsEqual(draft, { ...draft })).toBe(true);
  });

  it("returns false when any editable draft field changes", () => {
    const draft = validDraft();
    expect(employeeDraftsEqual(draft, { ...draft, status: "serving_notice" })).toBe(
      false,
    );
  });
});

describe("validateEmployeeDraft", () => {
  it("requires last working date for serving notice", () => {
    expect(EMPLOYEE_STATUSES).toContain("serving_notice");
    expect(EMPLOYEE_STATUS_LABELS.serving_notice).toBe("Serving Notice");
    expect(
      validateEmployeeDraft({ ...validDraft(), status: "serving_notice" }),
    ).toMatchObject({
      lastWorkingDate: "Last working date is required for serving notice",
    });
    expect(
      validateEmployeeDraft({
        ...validDraft(),
        status: "serving_notice",
        lastWorkingDate: "2026-12-31",
      }),
    ).toEqual({});
  });

  it("requires email once a person is not joining", () => {
    expect(
      validateEmployeeDraft({ ...validDraft(), status: "active", email: "" }),
    ).toMatchObject({
      email: "Email cannot be empty for active employees",
    });
  });

  it("requires email when a joining person has reached their joining date", () => {
    expect(
      validateEmployeeDraft(
        { ...validDraft(), status: "joining", joiningDate: "2026-08-27", email: "" },
        "2026-08-27",
      ),
    ).toMatchObject({
      email: "Email cannot be empty for active employees",
    });
  });
});

describe("resolveEmployeeLifecycleStatus", () => {
  it("changes any status to serving notice through its last working date", () => {
    expect(
      resolveEmployeeLifecycleStatus(
        "active",
        { joiningDate: null, lastWorkingDate: "2026-08-27" },
        "2026-08-27",
      ),
    ).toBe("serving_notice");
    expect(
      resolveEmployeeLifecycleStatus(
        "joining",
        { joiningDate: "2026-09-01", lastWorkingDate: "2026-09-30" },
        "2026-08-27",
      ),
    ).toBe("serving_notice");
  });

  it("changes any status to resigned after last working date", () => {
    expect(
      resolveEmployeeLifecycleStatus(
        "active",
        { joiningDate: null, lastWorkingDate: "2026-08-26" },
        "2026-08-27",
      ),
    ).toBe("resigned");
    expect(
      resolveEmployeeLifecycleStatus(
        "joining",
        { joiningDate: "2026-08-01", lastWorkingDate: "2026-08-26" },
        "2026-08-27",
      ),
    ).toBe("resigned");
  });

  it("changes joining to active once the joining date is reached", () => {
    expect(
      resolveEmployeeLifecycleStatus(
        "joining",
        { joiningDate: "2026-08-27", lastWorkingDate: null },
        "2026-08-27",
      ),
    ).toBe("active");
  });

  it("leaves future joining people as joining", () => {
    expect(
      resolveEmployeeLifecycleStatus(
        "joining",
        { joiningDate: "2026-08-28", lastWorkingDate: null },
        "2026-08-27",
      ),
    ).toBe("joining");
  });
});

describe("employee writes", () => {
  it("inserts a person payload without a source flag (sandbox_tree_id is set at write time)", () => {
    const row = localEmployeeInsert(
      validDraft(),
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
    expect(row).not.toHaveProperty("source");
    expect(row).not.toHaveProperty("sandbox_tree_id");
    expect(row.full_name).toBe("Ada Lovelace");
    expect(row.email).toBe("ada@example.com");
  });

  it("stores a missing joining email as null", () => {
    const row = localEmployeeInsert(
      { ...validDraft(), status: "joining", email: "" },
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
    expect(row.email).toBeNull();
  });

  it("stores the lifecycle-resolved status for new people", () => {
    const row = localEmployeeInsert(
      { ...validDraft(), status: "joining", joiningDate: "2026-08-27" },
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "2026-08-27",
    );
    expect(row.status).toBe("active");
  });

  it("stores serving notice automatically when LWD is present", () => {
    const patch = memberPatchFromDraft({
      ...validDraft(),
      status: "active",
      lastWorkingDate: "2099-12-31",
    });
    expect(patch.status).toBe("serving_notice");
  });

  it("patches any person from the pending employee override draft", () => {
    const patch = memberPatchFromDraft(validDraft());
    expect(patch.displayName).toBe("Ada Lovelace");
    expect(patch.sourceName).toBe("Ada Lovelace");
    expect(patch.overrideName).toBe("Ada Lovelace");
    expect(patch.overrideTitle).toBe("Engineer");
    expect(patch.overrideAvatarUrl).toBeNull();
  });

  it("recomputes serving-notice styling when position level changes", () => {
    expect(
      memberPatchFromDraft({
        ...validDraft(),
        status: "serving_notice",
        positionLevel: "5",
      }).servingNoticeMuted,
    ).toBe(false);
    expect(
      memberPatchFromDraft({
        ...validDraft(),
        status: "serving_notice",
        positionLevel: "4",
      }).servingNoticeMuted,
    ).toBe(true);
  });
});

function seatMember(overrides: Partial<SeatMember> = {}): SeatMember {
  return {
    authId: "emp-1",
    displayName: "Ada Lovelace",
    displayTitle: "Engineer",
    email: "ada@example.com",
    avatarUrl: null,
    officeLocation: "Dubai",
    status: "active",
    joiningDate: null,
    isHost: true,
    sourceName: "Ada Lovelace",
    sourceTitle: "Engineer",
    sourceAvatarUrl: null,
    overrideName: null,
    overrideTitle: null,
    overrideAvatarUrl: null,
    ...overrides,
  };
}

describe("draftFromMember", () => {
  it("falls back to hiredAt when joiningDate is missing", () => {
    expect(
      draftFromMember(seatMember({ joiningDate: null, hiredAt: "2024-03-15" }))
        .joiningDate,
    ).toBe("2024-03-15");
  });

  it("prefers joiningDate over hiredAt", () => {
    expect(
      draftFromMember(seatMember({ joiningDate: "2024-01-01", hiredAt: "2024-03-15" }))
        .joiningDate,
    ).toBe("2024-01-01");
  });

  it("leaves joiningDate empty when both dates are missing", () => {
    expect(
      draftFromMember(seatMember({ joiningDate: null, hiredAt: null })).joiningDate,
    ).toBe("");
  });

  it("falls back to resignationDate when lastWorkingDate is missing", () => {
    expect(
      draftFromMember(
        seatMember({
          status: "resigned",
          lastWorkingDate: null,
          resignationDate: "2024-06-30",
        }),
      ).lastWorkingDate,
    ).toBe("2024-06-30");
  });

  it("prefers lastWorkingDate over resignationDate", () => {
    expect(
      draftFromMember(
        seatMember({
          status: "serving_notice",
          lastWorkingDate: "2024-07-15",
          resignationDate: "2024-06-01",
        }),
      ).lastWorkingDate,
    ).toBe("2024-07-15");
  });

  it("leaves lastWorkingDate empty when both exit dates are missing", () => {
    expect(
      draftFromMember(seatMember({ lastWorkingDate: null, resignationDate: null }))
        .lastWorkingDate,
    ).toBe("");
  });
});
