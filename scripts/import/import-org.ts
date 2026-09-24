import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { parse } from "csv-parse/sync";
import postgres, { type TransactionSql } from "postgres";
import {
  cleanImportRow,
  topologicalImportRows,
  validateImportRows,
  type ImportRow,
} from "./validation";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const file = argument("--file");
const organizationName = argument("--organization-name")?.trim();
const apply = process.argv.includes("--apply");
if (!file || !organizationName) {
  throw new Error(
    "Usage: npm run org:import -- --file <csv> --organization-name <name> [--apply]",
  );
}
const importFile = file;
const orgName = organizationName;

async function persist(tx: TransactionSql, rows: ImportRow[]) {
  const existing = await tx<{ count: number }[]>`
    select ((select count(*) from organelle.trees) + (select count(*) from organelle.employees))::int as count`;
  if ((existing[0]?.count ?? 0) !== 0)
    throw new Error("Import requires an empty organization");

  const ordered = topologicalImportRows(rows);
  const authByExternalId = new Map(rows.map((row) => [row.employee_id, randomUUID()]));
  const seatByExternalId = new Map<string, string>();
  const pathByExternalId = new Map(
    rows.map((row) => [
      row.employee_id,
      row.org_path
        .split(">")
        .map((part) => part.trim())
        .filter(Boolean),
    ]),
  );
  const rootId = randomUUID();
  const treeId = randomUUID();
  const creator = authByExternalId.get(ordered[0]!.employee_id)!;

  for (const row of rows) {
    await tx`insert into organelle.employees (
      auth_id, id, email, full_name, job_title, position_level, avatar_url,
      office_country, office_location, status, primary_manager_auth_id, primary_team_path
    ) values (
      ${authByExternalId.get(row.employee_id)!}, ${row.employee_id}, ${row.email},
      ${row.full_name}, ${row.job_title || null},
      ${row.position_level ? Number(row.position_level) : null}, ${row.avatar_url || null},
      ${row.office_country || null}, ${row.office_location || null}, ${row.status},
      ${row.manager_employee_id ? authByExternalId.get(row.manager_employee_id)! : null},
      ${row.org_path || null}
    )`;
  }
  await tx`insert into organelle.trees (
    tree_id, kind, version_seq, created_by_auth_id, published_at
  ) values (${treeId}, 'published', 1, ${creator}, now())`;
  await tx`insert into organelle.nodes (
    tree_id, node_id, parent_node_id, node_type, sort_order, name
  ) values (${treeId}, ${rootId}, null, 'header', 0, ${orgName})`;

  const headerByContext = new Map<string, string>();
  for (const [index, row] of ordered.entries()) {
    const managerSeat = row.manager_employee_id
      ? seatByExternalId.get(row.manager_employee_id)!
      : rootId;
    const managerPath = row.manager_employee_id
      ? (pathByExternalId.get(row.manager_employee_id) ?? [])
      : [];
    const ownPath = pathByExternalId.get(row.employee_id) ?? [];
    let common = 0;
    while (common < managerPath.length && managerPath[common] === ownPath[common])
      common++;
    let parentId = managerSeat;
    for (const segment of ownPath.slice(common)) {
      const key = `${parentId}\0${segment.toLowerCase()}`;
      let headerId = headerByContext.get(key);
      if (!headerId) {
        headerId = randomUUID();
        headerByContext.set(key, headerId);
        await tx`insert into organelle.nodes (
          tree_id, node_id, parent_node_id, node_type, sort_order, name
        ) values (${treeId}, ${headerId}, ${parentId}, 'header', ${index}, ${segment})`;
      }
      parentId = headerId;
    }
    const seatId = randomUUID();
    seatByExternalId.set(row.employee_id, seatId);
    await tx`insert into organelle.nodes (
      tree_id, node_id, parent_node_id, node_type, sort_order, job_title, position_level
    ) values (
      ${treeId}, ${seatId}, ${parentId}, 'seat', ${index}, ${row.job_title || null},
      ${row.position_level ? Number(row.position_level) : null}
    )`;
    await tx`insert into organelle.seat_assignments (
      tree_id, node_id, employee_auth_id, is_host, is_primary
    ) values (${treeId}, ${seatId}, ${authByExternalId.get(row.employee_id)!}, true, true)`;
  }
  await tx`select organelle.validate_tree(${treeId})`;
}

const raw = await readFile(importFile, "utf8");
const parsed = parse(raw, {
  columns: true,
  bom: true,
  skip_empty_lines: true,
  trim: true,
}) as Array<Record<string, string>>;
const rows = validateImportRows(parsed.map(cleanImportRow));
console.log(`Validated ${rows.length} employees for ${orgName}`);
if (!apply) {
  console.log("Dry run only. Re-run with --apply to create the organization.");
  process.exit(0);
}

const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL is required when using --apply");
const sql = postgres(url, { max: 1, prepare: false });
try {
  await sql.begin((tx) => persist(tx, rows));
  console.log("Organization imported as published version 1");
} finally {
  await sql.end();
}
