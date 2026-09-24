import { describe, expect, it } from "vitest";

import { draftSnapshotFromInsert } from "./draft-employees";

describe("draftSnapshotFromInsert", () => {
  it("copies localEmployeeInsert fields for change_log redo", () => {
    const snap = draftSnapshotFromInsert({
      auth_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      email: "ada@example.com",
      full_name: "Ada",
      legal_full_name: null,
      id: null,
      employment_record: null,
      job_title: "Engineer",
      position_level: null,
      avatar_url: null,
      office_country: null,
      office_location: null,
      hiring_company: null,
      status: "active",
      joining_date: null,
      hired_at: null,
      resignation_date: null,
      last_working_date: null,
    });
    expect(snap.email).toBe("ada@example.com");
    expect(snap.status).toBe("active");
  });
});
