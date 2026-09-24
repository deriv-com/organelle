export const IMPORT_STATUSES = new Set([
  "joining",
  "active",
  "serving_notice",
  "inactive",
  "resigned",
]);

export type ImportRow = {
  employee_id: string;
  email: string;
  full_name: string;
  manager_employee_id: string;
  job_title: string;
  position_level: string;
  org_path: string;
  status: string;
  office_location: string;
  office_country: string;
  avatar_url: string;
};

export function cleanImportRow(row: Record<string, string>): ImportRow {
  return {
    employee_id: row.employee_id?.trim() ?? "",
    email: row.email?.trim().toLowerCase() ?? "",
    full_name: row.full_name?.trim() ?? "",
    manager_employee_id: row.manager_employee_id?.trim() ?? "",
    job_title: row.job_title?.trim() ?? "",
    position_level: row.position_level?.trim() ?? "",
    org_path: row.org_path?.trim() ?? "",
    status: row.status?.trim().toLowerCase() || "active",
    office_location: row.office_location?.trim() ?? "",
    office_country: row.office_country?.trim() ?? "",
    avatar_url: row.avatar_url?.trim() ?? "",
  };
}

export function validateImportRows(rows: ImportRow[]): ImportRow[] {
  if (rows.length === 0) throw new Error("CSV contains no employees");
  const ids = new Set<string>();
  const emails = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const line = index + 2;
    if (!row.employee_id || !row.email || !row.full_name) {
      throw new Error(`Line ${line}: employee_id, email, and full_name are required`);
    }
    if (ids.has(row.employee_id))
      throw new Error(`Line ${line}: duplicate employee_id`);
    if (emails.has(row.email)) throw new Error(`Line ${line}: duplicate email`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      throw new Error(`Line ${line}: invalid email`);
    }
    if (!IMPORT_STATUSES.has(row.status))
      throw new Error(`Line ${line}: invalid status`);
    if (row.position_level && !/^\d{1,2}$/.test(row.position_level)) {
      throw new Error(`Line ${line}: position_level must be 0-99`);
    }
    const segments = row.org_path
      .split(">")
      .map((part) => part.trim())
      .filter(Boolean);
    if (segments.length > 12) throw new Error(`Line ${line}: org_path is too deep`);
    ids.add(row.employee_id);
    emails.add(row.email);
  }
  for (const row of rows) {
    if (row.manager_employee_id && !ids.has(row.manager_employee_id)) {
      throw new Error(
        `Unknown manager ${row.manager_employee_id} for ${row.employee_id}`,
      );
    }
    if (row.manager_employee_id === row.employee_id) {
      throw new Error("An employee cannot manage themself");
    }
  }

  const byId = new Map(rows.map((row) => [row.employee_id, row]));
  for (const row of rows) {
    const seen = new Set([row.employee_id]);
    let current = row.manager_employee_id;
    while (current) {
      if (seen.has(current))
        throw new Error(`Manager cycle involving ${row.employee_id}`);
      seen.add(current);
      current = byId.get(current)?.manager_employee_id ?? "";
      if (seen.size > 16) {
        throw new Error(`Hierarchy exceeds the maximum depth for ${row.employee_id}`);
      }
    }
  }
  return rows;
}

export function topologicalImportRows(rows: ImportRow[]): ImportRow[] {
  const remaining = new Map(rows.map((row) => [row.employee_id, row]));
  const ordered: ImportRow[] = [];
  while (remaining.size) {
    const ready = [...remaining.values()]
      .filter(
        (row) => !row.manager_employee_id || !remaining.has(row.manager_employee_id),
      )
      .sort((a, b) => a.employee_id.localeCompare(b.employee_id));
    if (!ready.length) throw new Error("Manager cycle detected");
    for (const row of ready) {
      ordered.push(row);
      remaining.delete(row.employee_id);
    }
  }
  return ordered;
}
