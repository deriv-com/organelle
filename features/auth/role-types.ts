import type { AppRole } from "./policy";

export type RoleRow = {
  authId: string;
  name: string;
  email: string;
  role: AppRole;
};

export type RoleDirectoryQueryRow = {
  auth_id: string;
  full_name: string | null;
  email: string;
  role: AppRole | null;
};

export function toRoleRow(row: RoleDirectoryQueryRow): RoleRow {
  return {
    authId: row.auth_id,
    name: row.full_name ?? "",
    email: row.email,
    role: row.role ?? "viewer",
  };
}
