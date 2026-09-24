import "server-only";

import { withDbRetry } from "@/lib/db";

import { mapSandboxSummary, type SandboxSummaryRow } from "./query-map";
import type { SandboxSummary, SharedSandboxSummary } from "./types";

export async function listSandboxesForActor(
  actorAuthId: string,
): Promise<SandboxSummary[]> {
  return withDbRetry(async (sql) => {
    const rows = await sql<SandboxSummaryRow[]>`
      select
        t.tree_id,
        t.name,
        t.created_at::text as created_at,
        t.forked_from_seq,
        t.owner_auth_id,
        t.archived_at::text as archived_at,
        count(cl.tree_id)::int as change_count,
        live.version_seq as live_seq
      from organelle.trees t
      cross join lateral (
        select version_seq
        from organelle.trees
        where kind = 'published'
        limit 1
      ) live
      left join organelle.change_log cl
        on cl.tree_id = t.tree_id
       and cl.op not in (
         'fork_sandbox', 'grant_sandbox_access', 'change_sandbox_access',
         'revoke_sandbox_access', 'expire_sandbox_access'
       )
      where t.kind = 'sandbox'
        and t.owner_auth_id = ${actorAuthId}
      group by
        t.tree_id, t.name, t.created_at, t.forked_from_seq, t.owner_auth_id,
        t.archived_at, live.version_seq
      order by t.created_at desc
    `;
    return rows.map(mapSandboxSummary);
  });
}

export async function listSharedSandboxesForActor(
  actorAuthId: string,
): Promise<SharedSandboxSummary[]> {
  return withDbRetry(async (sql) => {
    const rows = await sql<
      (SandboxSummaryRow & {
        access_level: "viewer" | "editor";
        owner_name: string | null;
        owner_email: string | null;
      })[]
    >`
      select
        t.tree_id,
        t.name,
        t.created_at::text as created_at,
        t.forked_from_seq,
        t.owner_auth_id,
        t.archived_at::text as archived_at,
        count(cl.tree_id)::int as change_count,
        live.version_seq as live_seq,
        case
          when recipient_role.role in ('publisher', 'admin', 'publisher') then 'editor'
          else s.access_level::text
        end as access_level,
        coalesce(
          nullif(trim(owner.full_name), ''),
          nullif(trim(owner.email), ''),
          'Unknown owner'
        ) as owner_name,
        owner.email as owner_email
      from organelle.sandbox_shares s
      join organelle.trees t on t.tree_id = s.sandbox_tree_id
      join organelle.employees owner on owner.auth_id = t.owner_auth_id
      left join organelle.app_roles recipient_role
        on recipient_role.auth_id = s.recipient_auth_id
      cross join lateral (
        select version_seq
        from organelle.trees
        where kind = 'published'
        limit 1
      ) live
      left join organelle.change_log cl
        on cl.tree_id = t.tree_id
       and cl.op not in (
         'fork_sandbox', 'grant_sandbox_access', 'change_sandbox_access',
         'revoke_sandbox_access', 'expire_sandbox_access'
       )
      where t.kind = 'sandbox'
        and s.recipient_auth_id = ${actorAuthId}
        and s.revoked_at is null
        and s.expired_at is null
      group by
        t.tree_id, t.name, t.created_at, t.forked_from_seq, t.owner_auth_id,
        t.archived_at, live.version_seq, s.access_level, owner.full_name,
        owner.email, recipient_role.role
      order by t.created_at desc
    `;
    return rows.map((row) => ({
      ...mapSandboxSummary(row),
      accessLevel: row.access_level,
      ownerName: row.owner_name?.trim() || row.owner_email?.trim() || "Unknown owner",
    }));
  });
}
