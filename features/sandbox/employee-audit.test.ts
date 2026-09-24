import { describe, expect, it } from "vitest";

import { emptyDraft } from "@/features/directory/employee-fields";
import {
  changedEmployeeSnapshot,
  employeeAuditSnapshotFromDraft,
  type EmployeeAuditSnapshot,
} from "./employee-audit";

function snapshot(partial: Partial<EmployeeAuditSnapshot> = {}): EmployeeAuditSnapshot {
  return {
    email: "amy@example.com",
    full_name: "Amy",
    legal_full_name: null,
    id: null,
    employment_record: null,
    job_title: "Engineer",
    position_level: null,
    avatar_url: null,
    office_country: null,
    office_location: "Dubai",
    hiring_company: null,
    status: "active",
    joining_date: null,
    hired_at: null,
    resignation_date: null,
    last_working_date: null,
    ...partial,
  };
}

describe("employee audit snapshots", () => {
  it("does not log fallback date prefill values as employee changes", () => {
    const before = snapshot({
      hired_at: "2024-03-15",
      resignation_date: "2024-03-15",
    });
    const after = employeeAuditSnapshotFromDraft(
      {
        ...emptyDraft(),
        fullName: "Amy Pond",
        email: "amy@example.com",
        jobTitle: "Engineer",
        officeLocation: "Dubai",
        status: "active",
        joiningDate: "2024-03-15",
        lastWorkingDate: "2024-03-15",
      },
      "employee-auth-id",
      before,
    );

    expect(changedEmployeeSnapshot(before, after)).toEqual({
      before: { full_name: "Amy" },
      after: { full_name: "Amy Pond" },
    });
  });

  it("logs visible date fields when they differ from the fallback values", () => {
    const before = snapshot({ hired_at: "2024-03-15" });
    const after = employeeAuditSnapshotFromDraft(
      {
        ...emptyDraft(),
        fullName: "Amy",
        email: "amy@example.com",
        jobTitle: "Engineer",
        officeLocation: "Dubai",
        status: "active",
        joiningDate: "2024-04-01",
      },
      "employee-auth-id",
      before,
    );

    expect(changedEmployeeSnapshot(before, after)).toMatchObject({
      before: { joining_date: null },
      after: { joining_date: "2024-04-01" },
    });
  });
});
