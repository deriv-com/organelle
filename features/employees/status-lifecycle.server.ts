import { withDbRetry } from "@/lib/db";
import { pruneResignedEmptySeats } from "./prune-resigned-seats.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function applyEmployeeStatusLifecycle(sql: any): Promise<number> {
  const updated = await sql<{ auth_id: string }[]>`
    update organelle.employees
    set status = case
      when last_working_date is not null and last_working_date < current_date
        then 'resigned'::organelle.employee_status
      when last_working_date is not null
        then 'serving_notice'::organelle.employee_status
      when status = 'joining'::organelle.employee_status
        and joining_date is not null
        and joining_date <= current_date
        then 'active'::organelle.employee_status
      else status
    end,
    status_updated_at = now()
    where status is distinct from case
      when last_working_date is not null and last_working_date < current_date
        then 'resigned'::organelle.employee_status
      when last_working_date is not null
        then 'serving_notice'::organelle.employee_status
      when status = 'joining'::organelle.employee_status
        and joining_date is not null
        and joining_date <= current_date
        then 'active'::organelle.employee_status
      else status
    end
    returning auth_id
  `;
  const published = (await sql<{ tree_id: string; created_by_auth_id: string }[]>`
    select tree_id, created_by_auth_id from organelle.trees where kind = 'published'
  `) as { tree_id: string; created_by_auth_id: string }[];
  if (published[0]) {
    await pruneResignedEmptySeats(
      sql,
      published[0].tree_id,
      published[0].created_by_auth_id,
    );
  }
  return updated.length;
}

export async function refreshEmployeeStatusLifecycle(): Promise<number> {
  return withDbRetry((sql) => applyEmployeeStatusLifecycle(sql));
}

export async function fetchEmployeeLifecycleCacheKey(): Promise<string> {
  return withDbRetry(async (sql) => {
    const rows = await sql<{ cache_key: string }[]>`
      select md5(coalesce(string_agg(
        auth_id::text || ':' ||
        status::text || ':' ||
        coalesce(joining_date::text, '') || ':' ||
        coalesce(last_working_date::text, ''),
        '|' order by auth_id::text
      ), '')) as cache_key
      from organelle.employees
    `;
    return rows[0]?.cache_key ?? "";
  });
}
