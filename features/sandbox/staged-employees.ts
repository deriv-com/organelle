import type { TransactionSql } from "postgres";

export type EmployeeEdit = {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};
// Explicit columns accepted from the sandbox person editor.
export const STAGED_EMPLOYEE_FIELDS = [
  "id",
  "employment_record",
  "full_name",
  "legal_full_name",
  "job_title",
  "position_level",
  "avatar_url",
  "office_location",
  "office_country",
  "hiring_company",
  "hired_at",
  "status",
  "joining_date",
  "last_working_date",
  "resignation_date",
  "primary_manager_auth_id",
  "primary_team_path",
] as const;

export function sameEmployeeField(field: string, a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function employeeEdit(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): EmployeeEdit {
  const edit: EmployeeEdit = { before: {}, after: {} };
  for (const field of STAGED_EMPLOYEE_FIELDS) {
    if (
      !Object.hasOwn(after, field) ||
      sameEmployeeField(field, before[field], after[field])
    )
      continue;
    edit.before[field] = before[field] ?? null;
    edit.after[field] = after[field] ?? null;
  }
  return edit;
}

export async function stageEmployeeEdit(
  tx: TransactionSql,
  treeId: string,
  authId: string,
  edit: EmployeeEdit,
) {
  if (!Object.keys(edit.after).length) return;
  await tx`insert into organelle.sandbox_employee_edits (tree_id, employee_auth_id, before_data, after_data)
    values (${treeId}, ${authId}, ${tx.json(JSON.parse(JSON.stringify(edit.before)))}, ${tx.json(JSON.parse(JSON.stringify(edit.after)))})
    on conflict (tree_id, employee_auth_id) do update
      set before_data = excluded.before_data || organelle.sandbox_employee_edits.before_data,
          after_data = organelle.sandbox_employee_edits.after_data || excluded.after_data`;
}

/** Fail rather than overwrite concurrent live person edits. Runs in the merge transaction. */
export async function applyStagedEmployeeEdits(tx: TransactionSql, treeId: string) {
  const edits = await tx<
    {
      employee_auth_id: string;
      before_data: Record<string, unknown>;
      after_data: Record<string, unknown>;
    }[]
  >`
    select employee_auth_id::text, before_data, after_data from organelle.sandbox_employee_edits where tree_id = ${treeId} order by employee_auth_id for update`;
  for (const edit of edits) {
    const rows = await tx<
      { data: Record<string, unknown> }[]
    >`select to_jsonb(e) as data from organelle.employees e where auth_id = ${edit.employee_auth_id} for update`;
    const current = rows[0]?.data;
    if (!current)
      throw new Error(
        "A staged employee no longer exists. Create a new sandbox and try again.",
      );
    for (const field of STAGED_EMPLOYEE_FIELDS) {
      if (!Object.hasOwn(edit.after_data, field)) continue;
      if (
        !sameEmployeeField(field, current[field], edit.before_data[field]) &&
        !sameEmployeeField(field, current[field], edit.after_data[field])
      ) {
        throw new Error(
          `A staged employee's ${field} changed in live. Create a new sandbox before merging.`,
        );
      }
    }
    const patch = Object.fromEntries(
      STAGED_EMPLOYEE_FIELDS.filter((key) => Object.hasOwn(edit.after_data, key)).map(
        (key) => [key, edit.after_data[key]],
      ),
    );
    // Sandbox overrides are promoted by apply_merge; staged edits must not clear them.
    if (Object.keys(patch).length)
      await tx`update organelle.employees set ${tx(patch)}, updated_at = now(), status_updated_at = case when status::text is distinct from ${String(patch.status ?? current.status)} then now() else status_updated_at end where auth_id = ${edit.employee_auth_id}`;
  }
}
