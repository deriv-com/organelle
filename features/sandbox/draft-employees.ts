/**
 * Sandbox draft employees: people with sandbox_tree_id set
 * exist only for that sandbox until merge promotes them or last-seat cleanup
 * / tree delete removes them.
 */

import type { TransactionSql } from "postgres";

export type DraftEmployeeSnapshot = {
  auth_id: string;
  email: string | null;
  full_name: string | null;
  legal_full_name: string | null;
  id: string | null;
  employment_record: string | null;
  job_title: string | null;
  position_level: number | null;
  avatar_url: string | null;
  office_country: string | null;
  office_location: string | null;
  hiring_company: string | null;
  status: string;
  joining_date: string | null;
  hired_at: string | null;
  resignation_date: string | null;
  last_working_date: string | null;
};

/** Delete a draft person when they have no seats left in this sandbox. */
export async function deleteDraftEmployeeIfOrphaned(
  tx: TransactionSql,
  treeId: string,
  authId: string,
): Promise<void> {
  await tx`
    delete from organelle.employees e
    where e.auth_id = ${authId}
      and e.sandbox_tree_id = ${treeId}
      and not exists (
        select 1 from organelle.seat_assignments sa
        where sa.tree_id = ${treeId}
          and sa.employee_auth_id = ${authId}
      )
  `;
}

export async function loadDraftSnapshots(
  tx: TransactionSql,
  treeId: string,
  authIds: string[],
): Promise<Record<string, DraftEmployeeSnapshot>> {
  if (authIds.length === 0) return {};
  const rows = (await tx`
    select auth_id, email, full_name, legal_full_name, id, employment_record,
           job_title, position_level, avatar_url, office_country, office_location,
           hiring_company, status::text as status,
           joining_date::text as joining_date, hired_at::text as hired_at,
           resignation_date::text as resignation_date,
           last_working_date::text as last_working_date
    from organelle.employees
    where sandbox_tree_id = ${treeId}
      and auth_id = any(${authIds}::uuid[])
  `) as unknown as DraftEmployeeSnapshot[];
  const out: Record<string, DraftEmployeeSnapshot> = {};
  for (const row of rows) out[row.auth_id] = row;
  return out;
}

/** Re-insert a draft employee from a change_log snapshot (undo/redo). */
export async function ensureDraftEmployee(
  tx: TransactionSql,
  treeId: string,
  snap: DraftEmployeeSnapshot,
): Promise<void> {
  await tx`
    insert into organelle.employees (
      auth_id, email, full_name, legal_full_name, id, employment_record,
      job_title, position_level, avatar_url, office_country, office_location,
      hiring_company, status, joining_date, hired_at, resignation_date,
      last_working_date, sandbox_tree_id
    ) values (
      ${snap.auth_id}, ${snap.email}, ${snap.full_name}, ${snap.legal_full_name},
      ${snap.id}, ${snap.employment_record}, ${snap.job_title}, ${snap.position_level},
      ${snap.avatar_url}, ${snap.office_country}, ${snap.office_location},
      ${snap.hiring_company},
      ${snap.status}::organelle.employee_status,
      ${snap.joining_date}, ${snap.hired_at}, ${snap.resignation_date},
      ${snap.last_working_date}, ${treeId}
    )
    on conflict (auth_id) do nothing
  `;
}

export function draftSnapshotFromInsert(row: {
  auth_id: string;
  email: string | null;
  full_name: string;
  legal_full_name: string | null;
  id: string | null;
  employment_record: string | null;
  job_title: string | null;
  position_level: number | null;
  avatar_url: string | null;
  office_country: string | null;
  office_location: string | null;
  hiring_company: string | null;
  status: string;
  joining_date: string | null;
  hired_at: string | null;
  resignation_date: string | null;
  last_working_date: string | null;
}): DraftEmployeeSnapshot {
  return { ...row };
}
