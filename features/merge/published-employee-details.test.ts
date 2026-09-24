import { beforeEach, describe, expect, it, vi } from "vitest";

const withDbRetry = vi.fn();

vi.mock("@/lib/db", () => ({
  withDbRetry: (...args: unknown[]) => withDbRetry(...args),
}));

import { fetchPublishedEmployeeDetails } from "./published-employee-details";

describe("fetchPublishedEmployeeDetails", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads unplaced global employees and excludes sandbox drafts", async () => {
    let query = "";
    const sql = (strings: TemplateStringsArray) => {
      query = strings.join("?");
      return [
        {
          auth_id: "00000000-0000-4000-8000-000000000001",
          full_name: "Global Employee",
          job_title: "Engineer",
          avatar_url: null,
          email: "global@example.com",
          legal_full_name: null,
          office_country: "MY",
          office_location: "Kuala Lumpur",
          hiring_company: null,
          status: "active",
          joining_date: null,
          hired_at: null,
          resignation_date: null,
          last_working_date: null,
          external_id: "1001",
          employment_record: null,
          position_level: 4,
          primary_manager_auth_id: null,
          primary_team_path: null,
        },
      ];
    };
    withDbRetry.mockImplementation(
      async (callback: (queryable: typeof sql) => unknown) => callback(sql),
    );

    const result = await fetchPublishedEmployeeDetails([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ]);

    expect(query).toContain("sandbox_tree_id is null");
    expect(result["00000000-0000-4000-8000-000000000001"]).toMatchObject({
      displayName: "Global Employee",
      officeLocation: "Kuala Lumpur",
      positionLevel: 4,
    });
    expect(result["00000000-0000-4000-8000-000000000002"]).toBeUndefined();
  });

  it("skips the database when there are no override subjects", async () => {
    await expect(fetchPublishedEmployeeDetails([])).resolves.toEqual({});
    expect(withDbRetry).not.toHaveBeenCalled();
  });
});
