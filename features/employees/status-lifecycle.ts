/** Keep the SQL CASE in `applyEmployeeStatusLifecycle` in sync with this helper. */
export function nextLifecycleStatus(input: {
  status: string;
  joiningDate: string | null;
  lastWorkingDate: string | null;
  today: string;
}): string {
  if (input.lastWorkingDate && input.lastWorkingDate < input.today) return "resigned";
  if (input.lastWorkingDate) return "serving_notice";
  if (
    input.status === "joining" &&
    input.joiningDate &&
    input.joiningDate <= input.today
  ) {
    return "active";
  }
  return input.status;
}
