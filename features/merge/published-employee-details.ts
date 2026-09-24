import { withDbRetry } from "@/lib/db";

import type { OverrideMap } from "./types";

type PublishedEmployeeDetailRow = {
  auth_id: string;
  full_name: string | null;
  job_title: string | null;
  avatar_url: string | null;
  email: string | null;
  legal_full_name: string | null;
  office_country: string | null;
  office_location: string | null;
  hiring_company: string | null;
  status: "joining" | "active" | "serving_notice" | "inactive" | "resigned";
  joining_date: string | null;
  hired_at: string | null;
  resignation_date: string | null;
  last_working_date: string | null;
  external_id: string | null;
  employment_record: string | null;
  position_level: number | null;
  primary_manager_auth_id: string | null;
  primary_team_path: string | null;
};

/** Current published/global values for merge override subjects, including unplaced people. */
export async function fetchPublishedEmployeeDetails(
  authIds: string[],
): Promise<OverrideMap> {
  const uniqueAuthIds = [...new Set(authIds)];
  if (uniqueAuthIds.length === 0) return {};

  return withDbRetry(async (sql) => {
    const rows = await sql<PublishedEmployeeDetailRow[]>`
      select auth_id::text as auth_id, full_name, job_title, avatar_url, email,
             legal_full_name, office_country, office_location, hiring_company,
             status::text as status, joining_date::text as joining_date,
             hired_at::text as hired_at, resignation_date::text as resignation_date,
             last_working_date::text as last_working_date, id as external_id,
             employment_record, position_level, primary_manager_auth_id::text,
             primary_team_path
      from organelle.employees
      where auth_id = any(${uniqueAuthIds}::uuid[])
        and sandbox_tree_id is null
    `;

    return Object.fromEntries(
      rows.map((row) => [
        row.auth_id,
        {
          displayName: row.full_name,
          displayTitle: row.job_title,
          avatarUrl: row.avatar_url,
          legalFullName: row.legal_full_name,
          officeCountry: row.office_country,
          officeLocation: row.office_location,
          hiringCompany: row.hiring_company,
          status: row.status,
          joiningDate: row.joining_date,
          hiredAt: row.hired_at,
          resignationDate: row.resignation_date,
          lastWorkingDate: row.last_working_date,
          employeeId: row.external_id,
          employmentRecord: row.employment_record,
          positionLevel: row.position_level,
          primaryManagerAuthId: row.primary_manager_auth_id,
          primaryTeamPath: row.primary_team_path,
        },
      ]),
    );
  });
}
