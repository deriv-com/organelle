import type { Sql, TransactionSql } from "postgres";

import {
  EDITOR_ROLES,
  MERGE_ROLES,
  SANDBOX_SHARING_ROLES,
  hasAllowedRole,
  type Actor,
} from "@/features/auth/policy";
import { withDbRetry } from "@/lib/db";
import { UUID_RE } from "@/lib/uuid";

export type SandboxShareLevel = "viewer" | "editor";

export type SandboxAccess = {
  treeId: string;
  ownerAuthId: string;
  archived: boolean;
  shareLevel: SandboxShareLevel | null;
  isOwner: boolean;
  canMerge: boolean;
  canView: boolean;
  canEdit: boolean;
  canPublish: boolean;
  canManageSharing: boolean;
  canManageLifecycle: boolean;
  canReadHistory: boolean;
};

type Queryable = Sql | TransactionSql;

export function effectiveSandboxShareLevel(
  role: Actor["role"],
  assignedLevel: SandboxShareLevel | null,
): SandboxShareLevel | null {
  if (assignedLevel === null) return null;
  if (hasAllowedRole(role, MERGE_ROLES)) return "editor";
  if (assignedLevel === "editor" && hasAllowedRole(role, EDITOR_ROLES)) {
    return "editor";
  }
  return "viewer";
}

export function resolveSandboxAccess(args: {
  treeId: string;
  ownerAuthId: string;
  archived: boolean;
  shareLevel: SandboxShareLevel | null;
  actor: Actor;
}): SandboxAccess {
  const isOwner = args.ownerAuthId === args.actor.authId;
  const ownerHasWorkspaceRole =
    isOwner && hasAllowedRole(args.actor.role, EDITOR_ROLES);
  const canMerge = hasAllowedRole(args.actor.role, MERGE_ROLES);
  const shareLevel = effectiveSandboxShareLevel(args.actor.role, args.shareLevel);
  const canManageSharing =
    ownerHasWorkspaceRole || hasAllowedRole(args.actor.role, SANDBOX_SHARING_ROLES);
  const active = !args.archived;
  const canView = ownerHasWorkspaceRole || shareLevel !== null;
  return {
    treeId: args.treeId,
    ownerAuthId: args.ownerAuthId,
    archived: args.archived,
    shareLevel,
    isOwner,
    canMerge,
    canView,
    canEdit: active && (ownerHasWorkspaceRole || shareLevel === "editor"),
    canPublish: active && canMerge && (ownerHasWorkspaceRole || shareLevel !== null),
    canManageSharing,
    canManageLifecycle: ownerHasWorkspaceRole,
    canReadHistory: ownerHasWorkspaceRole,
  };
}

export async function sandboxAccessWithSql(
  sql: Queryable,
  treeId: string,
  actor: Actor,
  options?: { lock?: boolean },
): Promise<SandboxAccess | null> {
  if (!UUID_RE.test(treeId)) return null;
  const lock = options?.lock ? sql`for update of t` : sql``;
  const rows = await sql<
    {
      tree_id: string;
      owner_auth_id: string;
      archived_at: string | null;
      access_level: SandboxShareLevel | null;
    }[]
  >`
    select t.tree_id, t.owner_auth_id, t.archived_at::text,
           s.access_level::text as access_level
    from organelle.trees t
    left join organelle.sandbox_shares s
      on s.sandbox_tree_id = t.tree_id
     and s.recipient_auth_id = ${actor.authId}
     and s.revoked_at is null
     and s.expired_at is null
    where t.tree_id = ${treeId} and t.kind = 'sandbox'
    ${lock}
  `;
  const row = rows[0];
  if (!row) return null;

  return resolveSandboxAccess({
    treeId: row.tree_id,
    ownerAuthId: row.owner_auth_id,
    archived: row.archived_at !== null,
    shareLevel: row.access_level,
    actor,
  });
}

export async function getSandboxAccess(
  treeId: string,
  actor: Actor,
): Promise<SandboxAccess | null> {
  return withDbRetry((sql) => sandboxAccessWithSql(sql, treeId, actor));
}

export async function hasSandboxWorkspaceAccess(actor: Actor): Promise<boolean> {
  const ownerHasWorkspaceRole = hasAllowedRole(actor.role, EDITOR_ROLES);
  return withDbRetry(async (sql) => {
    const rows = await sql<{ found: boolean }[]>`
      select exists (
        select 1 from organelle.trees t
        where t.kind = 'sandbox'
          and (
            (${ownerHasWorkspaceRole} and t.owner_auth_id = ${actor.authId})
            or exists (
              select 1 from organelle.sandbox_shares s
              where s.sandbox_tree_id = t.tree_id
                and s.recipient_auth_id = ${actor.authId}
                and s.revoked_at is null
                and s.expired_at is null
            )
          )
      ) as found
    `;
    return rows[0]?.found ?? false;
  });
}
