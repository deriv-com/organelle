import "server-only";

import { withDbRetry } from "@/lib/db";

import {
  AUDIT_PAGE_SIZE,
  auditOffset,
  auditSearchTokens,
  type AuditFilters,
} from "./filters";
import { operationActionLabel } from "./format";
import type { AuditActorOption, AuditOpOption, AuditPageData } from "./types";

type AuditRow = {
  id: string;
  created_at: string;
  op: string;
  actor_auth_id: string;
  target_auth_id: string | null;
  tree_id: string | null;
  node_id: string | null;
  merge_id: string | null;
  command_id: string | null;
  command_kind: string | null;
  undoes_command_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  actor_avatar_url: string | null;
  target_employee_name: string | null;
  target_employee_email: string | null;
  node_name: string | null;
  node_job_title: string | null;
  tree_kind: string | null;
  tree_name: string | null;
  version_seq: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  total_count: number;
};

export async function listAuditEvents(filters: AuditFilters): Promise<AuditPageData> {
  const tokens = auditSearchTokens(filters.query);
  const offset = auditOffset(filters.page);

  return withDbRetry(async (sql) => {
    const rows = await sql<AuditRow[]>`
      with filtered as (
        select
          cl.id,
          cl.created_at,
          cl.op,
          cl.actor_auth_id,
          coalesce(cl.employee_auth_id, (cl.before->'members'->>0)::uuid) as target_auth_id,
          cl.tree_id,
          cl.node_id,
          cl.merge_id,
          cl.command_id,
          cl.command_kind,
          cl.undoes_command_id,
          cl.before,
          cl.after,
          t.kind as tree_kind,
          t.name as tree_name,
          t.version_seq,
          actor.full_name as actor_name,
          actor.email as actor_email,
          actor.avatar_url as actor_avatar_url,
          target.full_name as target_employee_name,
          target.email as target_employee_email,
          n.name as node_name,
          n.job_title as node_job_title,
          concat_ws(
            ' ',
            cl.op::text,
            replace(cl.op::text, '_', ' '),
            case cl.op::text
              when 'create_header' then 'create created team header'
              when 'rename_header' then 'rename renamed team header'
              when 'delete_header' then 'remove removed delete deleted team header'
              when 'create_seat' then 'create created position seat employee'
              when 'delete_seat' then 'remove removed delete deleted position seat employee'
              when 'move_node' then 'move moved employee item node'
              when 'set_assistant' then 'assistant placement changed'
              when 'set_leaf_grid_columns' then 'layout columns changed'
              when 'reorder_node' then 'move reorder reordered item'
              when 'assign_employee' then 'peer added assigned employee'
              when 'unassign_employee' then 'peer removed unassigned employee'
              when 'set_peer_host' then 'peer host primary changed'
              when 'set_override' then 'update updated details override employee'
              when 'clear_override' then 'clear cleared update override employee'
              when 'update_employee' then 'update updated employee'
              when 'set_primary_seat' then 'primary seat changed employee'
              when 'rename_seat' then 'rename renamed position seat'
              when 'grant_role' then 'grant granted role user'
              when 'revoke_role' then 'revoke revoked role user'
              when 'grant_sandbox_access' then 'grant granted sandbox access user'
              when 'change_sandbox_access' then 'change changed sandbox access user'
              when 'revoke_sandbox_access' then 'revoke revoked sandbox access user'
              when 'expire_sandbox_access' then 'expire expired sandbox access published user'
              when 'fork_sandbox' then 'fork forked sandbox create created'
              when 'merge_sandbox' then 'merge merged sandbox published'
              when 'sync_from_live' then 'sync synced live sandbox'
              when 'restore_version' then 'restore restored version published'
              else ''
            end,
            actor.full_name,
            actor.email,
            target.full_name,
            target.email,
            t.kind::text,
            t.name,
            case when t.version_seq is null then null else 'v' || t.version_seq::text end,
            n.name,
            n.job_title,
            cl.before::text,
            cl.after::text
          ) as search_text
        from organelle.change_log cl
        left join organelle.trees t on t.tree_id = cl.tree_id
        left join organelle.employees actor
          on actor.auth_id = cl.actor_auth_id
         and actor.sandbox_tree_id is null
        left join organelle.employees target
          on target.auth_id = coalesce(cl.employee_auth_id, (cl.before->'members'->>0)::uuid)
        left join organelle.nodes n
          on n.tree_id = cl.tree_id
         and n.node_id = cl.node_id
        where (
            ${filters.scope} = 'all'
            or (${filters.scope} = 'published' and t.kind in ('published', 'historical'))
            or (
              ${filters.scope} = 'sandbox'
              and (t.kind = 'sandbox' or cl.tree_id is null)
            )
          )
          and (${filters.actor}::text is null or cl.actor_auth_id::text = ${filters.actor})
          and (${filters.op}::text is null or cl.op::text = ${filters.op})
      )
      select
        id::text,
        created_at::text,
        op::text,
        actor_auth_id::text,
        target_auth_id::text,
        tree_id::text,
        node_id::text,
        merge_id::text,
        command_id::text,
        command_kind::text,
        undoes_command_id::text,
        actor_name,
        actor_email,
        actor_avatar_url,
        target_employee_name,
        target_employee_email,
        node_name,
        node_job_title,
        tree_kind::text,
        tree_name,
        version_seq,
        before,
        after,
        count(*) over()::int as total_count
      from filtered
      where not exists (
        select 1
        from unnest(${tokens}::text[]) token
        where lower(filtered.search_text) not like ('%' || token || '%')
      )
      order by id desc
      limit ${AUDIT_PAGE_SIZE}
      offset ${offset}
    `;

    const total = rows[0]?.total_count ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));

    return {
      rows: rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        op: row.op,
        actorAuthId: row.actor_auth_id,
        actorName: row.actor_name,
        actorEmail: row.actor_email,
        actorAvatarUrl: row.actor_avatar_url,
        targetEmployeeAuthId: row.target_auth_id,
        targetEmployeeName: row.target_employee_name,
        targetEmployeeEmail: row.target_employee_email,
        treeId: row.tree_id,
        nodeId: row.node_id,
        nodeName: row.node_name,
        nodeJobTitle: row.node_job_title,
        treeKind: row.tree_kind,
        treeName: row.tree_name,
        versionSeq: row.version_seq === null ? null : Number(row.version_seq),
        mergeId: row.merge_id,
        commandId: row.command_id,
        commandKind: row.command_kind,
        undoesCommandId: row.undoes_command_id,
        before: row.before,
        after: row.after,
      })),
      total,
      page: filters.page,
      pageCount,
    };
  });
}

export async function listAuditActors(): Promise<AuditActorOption[]> {
  return withDbRetry(async (sql) => {
    const rows = await sql<
      { auth_id: string; full_name: string | null; email: string | null }[]
    >`
      select distinct
        cl.actor_auth_id as auth_id,
        actor.full_name,
        actor.email
      from organelle.change_log cl
      left join organelle.employees actor
        on actor.auth_id = cl.actor_auth_id
       and actor.sandbox_tree_id is null
      order by actor.full_name nulls last, actor.email nulls last, cl.actor_auth_id
    `;
    return rows.map((row) => ({
      authId: row.auth_id,
      name: row.full_name?.trim() || row.email?.trim() || "Unknown actor",
      email: row.email,
    }));
  });
}

export async function listAuditOps(): Promise<AuditOpOption[]> {
  return withDbRetry(async (sql) => {
    const rows = await sql<{ op: string }[]>`
      select distinct op::text as op
      from organelle.change_log
      order by op::text
    `;
    return rows
      .map((row) => ({ op: row.op, label: operationActionLabel(row.op) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });
}
