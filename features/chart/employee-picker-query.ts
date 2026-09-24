/**
 * Sandbox Add-position catalog query. Server-only — imported from the sandbox
 * page, never from ChartClient (postgres uses Node `net`).
 */

import { withDbRetry } from "@/lib/db";

import { mapPickerRows, type PickerEmployeeRow } from "./employee-picker";
import type { SeatMember } from "./chart-row";

export async function fetchPickerEmployees(treeId: string): Promise<SeatMember[]> {
  return withDbRetry(async (sql) => {
    const rows = await sql<PickerEmployeeRow[]>`
      select e.auth_id, e.full_name, e.email, e.job_title, e.avatar_url,
             e.office_location, e.status, e.joining_date::text as joining_date,
             e.position_level,
             o.auth_id as override_auth_id,
             o.display_name, o.display_title, o.avatar_url as override_avatar_url,
             o.status as override_status,
             o.position_level as override_position_level
      from organelle.employees original_employee
      left join organelle.sandbox_employee_edits edits
        on edits.employee_auth_id = original_employee.auth_id and edits.tree_id = ${treeId}
      cross join lateral jsonb_populate_record(
        null::organelle.employees,
        to_jsonb(original_employee) || coalesce(edits.after_data, '{}'::jsonb)
      ) e
      left join organelle.employee_overrides o
        on o.tree_id = ${treeId} and o.auth_id = e.auth_id
      where e.sandbox_tree_id is null or e.sandbox_tree_id = ${treeId}
      order by coalesce(o.display_name, e.full_name)
    `;
    return mapPickerRows(rows);
  });
}
