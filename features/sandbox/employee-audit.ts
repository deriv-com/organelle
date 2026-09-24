import {
  localEmployeeInsert,
  resolveEmployeeLifecycleStatus,
  type EmployeeDraft,
} from "@/features/directory/employee-fields";

export type EmployeeAuditSnapshot = {
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
  status: string | null;
  joining_date: string | null;
  hired_at: string | null;
  resignation_date: string | null;
  last_working_date: string | null;
};

export type EmployeeAuditRow = EmployeeAuditSnapshot & {
  sandbox_tree_id: string | null;
};

const EMPLOYEE_AUDIT_FIELDS = [
  "email",
  "full_name",
  "legal_full_name",
  "id",
  "employment_record",
  "job_title",
  "position_level",
  "avatar_url",
  "office_country",
  "office_location",
  "hiring_company",
  "status",
  "joining_date",
  "hired_at",
  "resignation_date",
  "last_working_date",
] as const satisfies readonly (keyof EmployeeAuditSnapshot)[];

function visibleDateValue(
  nextValue: string | null,
  currentValue: string | null,
  fallbackValue: string | null,
): string | null {
  if (currentValue == null && fallbackValue != null && nextValue === fallbackValue) {
    return null;
  }
  return nextValue;
}

export function employeeAuditSnapshotFromDraft(
  draft: EmployeeDraft,
  employeeAuthId: string,
  before: EmployeeAuditSnapshot,
): EmployeeAuditSnapshot {
  const normalized = localEmployeeInsert(draft, employeeAuthId);
  const joiningDate = visibleDateValue(
    normalized.joining_date,
    before.joining_date,
    before.hired_at,
  );
  const lastWorkingDate = visibleDateValue(
    normalized.last_working_date,
    before.last_working_date,
    before.resignation_date,
  );
  return {
    email: normalized.email,
    full_name: normalized.full_name,
    legal_full_name: before.legal_full_name,
    id: normalized.id,
    employment_record: normalized.employment_record,
    job_title: normalized.job_title,
    position_level: before.position_level,
    avatar_url: normalized.avatar_url,
    office_country: before.office_country,
    office_location: normalized.office_location,
    hiring_company: before.hiring_company,
    status: resolveEmployeeLifecycleStatus(draft.status, {
      joiningDate,
      lastWorkingDate,
    }),
    joining_date: joiningDate,
    hired_at: before.hired_at,
    resignation_date: before.resignation_date,
    last_working_date: lastWorkingDate,
  };
}

export function changedEmployeeSnapshot(
  before: EmployeeAuditSnapshot,
  after: EmployeeAuditSnapshot,
): { before: Partial<EmployeeAuditSnapshot>; after: Partial<EmployeeAuditSnapshot> } {
  const beforeChanged: Record<string, string | number | null> = {};
  const afterChanged: Record<string, string | number | null> = {};
  for (const field of EMPLOYEE_AUDIT_FIELDS) {
    if (before[field] === after[field]) continue;
    beforeChanged[field] = before[field];
    afterChanged[field] = after[field];
  }
  return { before: beforeChanged, after: afterChanged };
}
