import "server-only";

import { withDbRetry } from "@/lib/db";
import { getCachedRoleDirectoryRows, rememberRoleDirectoryRows } from "./role-cache";
import type { RoleDirectoryQueryRow, RoleRow } from "./role-types";
import { toRoleRow } from "./role-types";

type RoleDirectoryCacheState = "hit" | "miss";

async function queryRoleDirectoryRows(): Promise<RoleRow[]> {
  return withDbRetry(async (sql) => {
    const rows = await sql<RoleDirectoryQueryRow[]>`
      select e.auth_id, e.full_name, e.email, r.role
      from organelle.employees e
      left join organelle.app_roles r on r.auth_id = e.auth_id
      where e.sandbox_tree_id is null
      order by e.full_name
    `;
    return rows.map(toRoleRow);
  });
}

export async function listCachedRoleDirectoryRows(): Promise<{
  rows: RoleRow[];
  cache: RoleDirectoryCacheState;
}> {
  const cached = getCachedRoleDirectoryRows();
  if (cached) return { rows: cached, cache: "hit" };

  const rows = await queryRoleDirectoryRows();
  return { rows: rememberRoleDirectoryRows(rows), cache: "miss" };
}

export async function listRoleDirectoryRows(): Promise<RoleRow[]> {
  return (await listCachedRoleDirectoryRows()).rows;
}
