"use server";

import {
  EDITOR_ROLES,
  SANDBOX_SHARING_ROLES,
  hasAllowedRole,
  requireActor,
  requireRole,
  type AppRole,
} from "@/features/auth/session";
import { withDbRetry } from "@/lib/db";
import { UUID_RE } from "@/lib/uuid";

import { sandboxAccessWithSql, type SandboxShareLevel } from "./access";

export type SharePerson = {
  authId: string;
  name: string;
  email: string;
  role: AppRole;
  avatarUrl?: string | null;
  jobTitle?: string | null;
  officeLocation?: string | null;
};

export type SandboxShareRow = SharePerson & {
  shareId: string;
  accessLevel: SandboxShareLevel;
  grantedAt: string;
  status: "active" | "revoked" | "expired";
};

export type SandboxShareDetails = {
  treeId: string;
  name: string;
  ownerName: string;
  ownerEmail: string;
  archived: boolean;
  canManage: boolean;
  shares: SandboxShareRow[];
  recipients: SharePerson[];
};

export type SandboxAccessOverview = {
  treeId: string;
  name: string;
  ownerAuthId: string;
  ownerName: string;
  archived: boolean;
  viewerCount: number;
  editorCount: number;
  updatedAt: string;
};

type ShareResult = { ok: true } | { ok: false; reason: string };

function validLevel(value: string): value is SandboxShareLevel {
  return value === "viewer" || value === "editor";
}

export async function getSandboxShareDetails(
  treeId: string,
): Promise<SandboxShareDetails | null> {
  if (!UUID_RE.test(treeId)) return null;
  const session = await requireActor();
  if (!session.ok) return null;

  return withDbRetry(async (sql) => {
    const access = await sandboxAccessWithSql(sql, treeId, session.actor);
    if (!access?.canManageSharing) return null;
    const trees = await sql<
      { name: string; owner_name: string; owner_email: string }[]
    >`
      select t.name,
             coalesce(
               nullif(trim(owner.full_name), ''),
               nullif(trim(owner.email), ''),
               'Unknown owner'
             ) as owner_name,
             coalesce(owner.email, '') as owner_email
      from organelle.trees t
      join organelle.employees owner on owner.auth_id = t.owner_auth_id
      where t.tree_id = ${treeId} and t.kind = 'sandbox'
    `;
    const tree = trees[0];
    if (!tree) return null;
    const rows = await sql<
      {
        share_id: string;
        auth_id: string;
        display_name: string;
        email: string;
        role: AppRole | null;
        access_level: SandboxShareLevel;
        granted_at: string;
        revoked_at: string | null;
        expired_at: string | null;
      }[]
    >`
      select s.share_id, e.auth_id,
             coalesce(nullif(trim(e.full_name), ''), e.email) as display_name,
             e.email, r.role::text,
             case
               when s.revoked_at is null and s.expired_at is null
                 and r.role in ('publisher', 'admin') then 'editor'
               when s.revoked_at is null and s.expired_at is null
                 and s.access_level = 'editor'
                 and coalesce(r.role::text, 'viewer')
                   not in ('editor', 'publisher', 'admin') then 'viewer'
               else s.access_level::text
             end as access_level,
             s.granted_at::text,
             s.revoked_at::text, s.expired_at::text
      from organelle.sandbox_shares s
      join organelle.employees e on e.auth_id = s.recipient_auth_id
      left join organelle.app_roles r on r.auth_id = e.auth_id
      where s.sandbox_tree_id = ${treeId}
      order by (s.revoked_at is null and s.expired_at is null) desc, s.granted_at desc
    `;
    const recipients = access.archived
      ? []
      : await sql<
          {
            auth_id: string;
            display_name: string;
            email: string;
            role: AppRole | null;
            avatar_url: string | null;
            job_title: string | null;
            office_location: string | null;
          }[]
        >`
          select
            e.auth_id,
            coalesce(nullif(trim(e.full_name), ''), e.email) as display_name,
            e.email,
            r.role::text,
            e.avatar_url,
            e.job_title,
            e.office_location
          from organelle.employees e
          left join organelle.app_roles r on r.auth_id = e.auth_id
          where e.sandbox_tree_id is null
            and e.auth_id <> ${access.ownerAuthId}
            and e.status in ('joining', 'active')
            and nullif(trim(e.email), '') is not null
            and not exists (
              select 1 from organelle.sandbox_shares s
              where s.sandbox_tree_id = ${treeId}
                and s.recipient_auth_id = e.auth_id
                and s.revoked_at is null and s.expired_at is null
            )
          order by display_name, e.email
        `;
    return {
      treeId,
      name: tree.name,
      ownerName: tree.owner_name,
      ownerEmail: tree.owner_email,
      archived: access.archived,
      canManage: true,
      shares: rows.map((row) => ({
        shareId: row.share_id,
        authId: row.auth_id,
        name: row.display_name,
        email: row.email,
        role: row.role ?? "viewer",
        accessLevel: row.access_level,
        grantedAt: row.granted_at,
        status: row.revoked_at ? "revoked" : row.expired_at ? "expired" : "active",
      })),
      recipients: recipients.map((row) => ({
        authId: row.auth_id,
        name: row.display_name,
        email: row.email,
        role: row.role ?? "viewer",
        avatarUrl: row.avatar_url,
        jobTitle: row.job_title,
        officeLocation: row.office_location,
      })),
    };
  });
}

export async function grantSandboxAccess(
  treeId: string,
  recipientAuthId: string,
  accessLevel: SandboxShareLevel,
): Promise<ShareResult> {
  if (
    !UUID_RE.test(treeId) ||
    !UUID_RE.test(recipientAuthId) ||
    !validLevel(accessLevel)
  ) {
    return { ok: false, reason: "Invalid sharing request" };
  }
  const session = await requireActor();
  if (!session.ok) return { ok: false, reason: "Not allowed" };

  return withDbRetry(async (sql) =>
    sql.begin(async (tx) => {
      const access = await sandboxAccessWithSql(tx, treeId, session.actor, {
        lock: true,
      });
      if (!access?.canManageSharing) return { ok: false, reason: "Not allowed" };
      if (access.archived)
        return { ok: false, reason: "Archived sandboxes cannot be shared" };
      if (recipientAuthId === access.ownerAuthId) {
        return { ok: false, reason: "The owner already has full access" };
      }
      const recipients = await tx<{ auth_id: string; role: AppRole }[]>`
        select e.auth_id, coalesce(r.role::text, 'viewer') as role
        from organelle.employees e
        left join organelle.app_roles r on r.auth_id = e.auth_id
        where e.auth_id = ${recipientAuthId}
          and e.sandbox_tree_id is null
          and e.status in ('joining', 'active')
          and nullif(trim(e.email), '') is not null
      `;
      if (recipients.length !== 1) return { ok: false, reason: "User not found" };
      if (
        accessLevel === "editor" &&
        !hasAllowedRole(recipients[0]!.role, EDITOR_ROLES)
      ) {
        return {
          ok: false,
          reason: "Editor access requires an Editor, Publisher, or Admin role",
        };
      }

      const current = await tx<{ share_id: string; access_level: SandboxShareLevel }[]>`
        select share_id, access_level::text as access_level
        from organelle.sandbox_shares
        where sandbox_tree_id = ${treeId}
          and recipient_auth_id = ${recipientAuthId}
          and revoked_at is null and expired_at is null
        for update
      `;
      if (current[0]?.access_level === accessLevel) return { ok: true };

      if (current[0]) {
        await tx`
          update organelle.sandbox_shares
          set revoked_at = now(), revoked_by_auth_id = ${session.actor.authId}
          where share_id = ${current[0].share_id}
        `;
      }
      await tx`
        insert into organelle.sandbox_shares
          (sandbox_tree_id, recipient_auth_id, access_level, granted_by_auth_id)
        values (
          ${treeId}, ${recipientAuthId}, ${accessLevel},
          ${session.actor.authId}
        )
      `;
      await tx`
        insert into organelle.change_log
          (tree_id, actor_auth_id, op, employee_auth_id, before, after)
        values (
          ${treeId}, ${session.actor.authId},
          ${current[0] ? "change_sandbox_access" : "grant_sandbox_access"},
          ${recipientAuthId},
          ${current[0] ? tx.json({ access_level: current[0].access_level }) : null},
          ${tx.json({ access_level: accessLevel })}
        )
      `;
      return { ok: true };
    }),
  );
}

export async function revokeSandboxAccess(
  treeId: string,
  shareId: string,
): Promise<ShareResult> {
  if (!UUID_RE.test(treeId) || !UUID_RE.test(shareId)) {
    return { ok: false, reason: "Invalid sharing request" };
  }
  const session = await requireActor();
  if (!session.ok) return { ok: false, reason: "Not allowed" };

  return withDbRetry(async (sql) =>
    sql.begin(async (tx) => {
      const access = await sandboxAccessWithSql(tx, treeId, session.actor, {
        lock: true,
      });
      if (!access?.canManageSharing) return { ok: false, reason: "Not allowed" };
      const rows = await tx<
        { recipient_auth_id: string; access_level: SandboxShareLevel }[]
      >`
        update organelle.sandbox_shares
        set revoked_at = now(), revoked_by_auth_id = ${session.actor.authId}
        where share_id = ${shareId} and sandbox_tree_id = ${treeId}
          and revoked_at is null and expired_at is null
        returning recipient_auth_id, access_level::text as access_level
      `;
      const row = rows[0];
      if (!row) return { ok: false, reason: "Access is no longer active" };
      await tx`
        insert into organelle.change_log
          (tree_id, actor_auth_id, op, employee_auth_id, before, after)
        values (
          ${treeId}, ${session.actor.authId}, 'revoke_sandbox_access',
          ${row.recipient_auth_id}, ${tx.json({ access_level: row.access_level })}, null
        )
      `;
      return { ok: true };
    }),
  );
}

export async function listSandboxAccessOverview(): Promise<SandboxAccessOverview[]> {
  const session = await requireRole(SANDBOX_SHARING_ROLES);
  if (!session.ok) return [];
  return withDbRetry(async (sql) => {
    const rows = await sql<
      {
        tree_id: string;
        name: string;
        owner_auth_id: string;
        owner_name: string | null;
        owner_email: string | null;
        archived_at: string | null;
        viewer_count: number;
        editor_count: number;
        updated_at: string;
      }[]
    >`
      select t.tree_id, t.name, t.owner_auth_id,
             coalesce(
               nullif(trim(owner.full_name), ''),
               nullif(trim(owner.email), ''),
               'Unknown owner'
             ) as owner_name,
             owner.email as owner_email,
             t.archived_at::text,
             count(s.share_id) filter (where
               case
                 when recipient_role.role in ('publisher', 'admin') then false
                 when s.access_level = 'editor'
                   then coalesce(recipient_role.role::text, 'viewer') <> 'editor'
                 else true
               end
             )::int as viewer_count,
             count(s.share_id) filter (where
               recipient_role.role in ('publisher', 'admin')
               or (
                 s.access_level = 'editor'
                 and recipient_role.role = 'editor'
               )
             )::int as editor_count,
             greatest(t.created_at, coalesce(max(s.granted_at), t.created_at))::text as updated_at
      from organelle.trees t
      join organelle.employees owner on owner.auth_id = t.owner_auth_id
      left join organelle.sandbox_shares s
        on s.sandbox_tree_id = t.tree_id
       and s.revoked_at is null and s.expired_at is null
      left join organelle.app_roles recipient_role
        on recipient_role.auth_id = s.recipient_auth_id
      where t.kind = 'sandbox'
      group by t.tree_id, t.name, t.owner_auth_id, owner.full_name, owner.email,
               t.archived_at, t.created_at
      order by updated_at desc
    `;
    return rows.map((row) => ({
      treeId: row.tree_id,
      name: row.name,
      ownerAuthId: row.owner_auth_id,
      ownerName: row.owner_name?.trim() || row.owner_email?.trim() || "Unknown owner",
      archived: row.archived_at !== null,
      viewerCount: row.viewer_count,
      editorCount: row.editor_count,
      updatedAt: row.updated_at,
    }));
  });
}
