/**
 * One query loads a complete tree without lazy subtree fetching or client-side joins.
 *
 * One row per (node, assignment): headers and vacant seats have exactly one row with
 * null member fields. Ordered host-first within each seat so the ChartRow builder can
 * keep array order.
 */

import type postgres from "postgres";

import { withDbRetry } from "@/lib/db";

type TreeSql = postgres.Sql | postgres.TransactionSql;

export interface TreeQueryRow {
  node_id: string;
  parent_node_id: string | null;
  node_type: "header" | "seat";
  sort_order: number;
  row_version: number;
  name: string | null;
  job_title: string | null;
  position_level: number | null;
  is_assistant: boolean;
  leaf_grid_columns: number;

  employee_auth_id: string | null;
  is_host: boolean | null;
  is_primary?: boolean | null;
  full_name: string | null;
  email: string | null;
  employee_job_title: string | null;
  employee_avatar_url: string | null;
  office_location: string | null;
  office_country?: string | null;
  hiring_company?: string | null;
  legal_full_name?: string | null;
  external_id?: string | null;
  employment_record?: string | null;
  employee_position_level?: number | null;
  status: "joining" | "active" | "serving_notice" | "inactive" | "resigned" | null;
  joining_date: string | null;
  hired_at?: string | null;
  resignation_date?: string | null;
  last_working_date?: string | null;
  primary_manager_auth_id?: string | null;
  primary_team_path?: string | null;

  override_display_name: string | null;
  override_display_title: string | null;
  override_avatar_url: string | null;
  override_auth_id?: string | null;
  override_node_id?: string | null;
  override_updated_by?: string | null;
  override_updated_at?: string | null;
  override_legal_full_name?: string | null;
  override_office_country?: string | null;
  override_office_location?: string | null;
  override_hiring_company?: string | null;
  override_status?:
    "joining" | "active" | "serving_notice" | "inactive" | "resigned" | null;
  override_joining_date?: string | null;
  override_hired_at?: string | null;
  override_resignation_date?: string | null;
  override_last_working_date?: string | null;
  override_external_id?: string | null;
  override_employment_record?: string | null;
  override_position_level?: number | null;
  override_primary_manager_auth_id?: string | null;
  override_primary_team_path?: string | null;
}

export interface TreePayload {
  treeId: string;
  versionSeq: number;
  publishedAt: string | null;
  rows: TreeQueryRow[];
}

export interface PublishedTreeMeta {
  treeId: string;
  versionSeq: number;
  publishedAt: string | null;
}

export interface SandboxPayload {
  treeId: string;
  name: string;
  kind: "published" | "historical" | "sandbox";
  archived: boolean;
  ownerAuthId: string | null;
  versionSeq: number | null;
  forkedFromSeq: number;
  forkedFromTreeId: string | null;
  rows: TreeQueryRow[];
}

// The row query is shared by every tree read; keep the column list in one place.
export async function selectTreeRows(
  sql: TreeSql,
  treeId: string,
): Promise<TreeQueryRow[]> {
  return sql<TreeQueryRow[]>`
    select
      n.node_id, n.parent_node_id, n.node_type, n.sort_order, n.row_version,
      n.name, n.job_title, n.position_level, n.is_assistant, n.leaf_grid_columns,
      sa.employee_auth_id, sa.is_host, sa.is_primary,
      e.full_name, e.email, e.job_title as employee_job_title,
      e.avatar_url as employee_avatar_url, e.office_location,
      e.office_country, e.hiring_company, e.legal_full_name,
      e.id as external_id, e.employment_record,
      e.position_level as employee_position_level,
      e.status, e.joining_date::text as joining_date,
      e.hired_at::text as hired_at,
      e.resignation_date::text as resignation_date,
      e.last_working_date::text as last_working_date,
      e.primary_manager_auth_id, e.primary_team_path,
      o.auth_id as override_auth_id,
      o.node_id as override_node_id,
      o.updated_by as override_updated_by,
      o.updated_at::text as override_updated_at,
      o.display_name as override_display_name,
      o.display_title as override_display_title,
      o.avatar_url as override_avatar_url,
      o.legal_full_name as override_legal_full_name,
      o.office_country as override_office_country,
      o.office_location as override_office_location,
      o.hiring_company as override_hiring_company,
      o.status as override_status,
      o.joining_date::text as override_joining_date,
      o.hired_at::text as override_hired_at,
      o.resignation_date::text as override_resignation_date,
      o.last_working_date::text as override_last_working_date,
      o.external_id as override_external_id,
      o.employment_record as override_employment_record,
      o.position_level as override_position_level,
      o.primary_manager_auth_id as override_primary_manager_auth_id,
      o.primary_team_path as override_primary_team_path
    from organelle.nodes n
    left join organelle.seat_assignments sa
      on sa.tree_id = n.tree_id and sa.node_id = n.node_id
    left join organelle.employees original_employee
      on original_employee.auth_id = sa.employee_auth_id
    left join organelle.sandbox_employee_edits edits
      on edits.tree_id = n.tree_id and edits.employee_auth_id = sa.employee_auth_id
    left join lateral jsonb_populate_record(null::organelle.employees,
      to_jsonb(original_employee) || coalesce(edits.after_data, '{}'::jsonb)) e on true
    left join organelle.employee_overrides o
      on o.tree_id = n.tree_id and o.auth_id = sa.employee_auth_id
    where n.tree_id = ${treeId}
    order by n.node_id, sa.is_host desc nulls last, sa.assigned_at
  `;
}

async function selectPublishedTreeMeta(sql: TreeSql): Promise<PublishedTreeMeta> {
  const trees = await sql<
    { tree_id: string; version_seq: number; published_at: string | null }[]
  >`
    select tree_id, version_seq, published_at::text
    from organelle.trees
    where kind = 'published'
  `;
  if (trees.length !== 1) {
    throw new Error(
      `Expected exactly one published tree, found ${trees.length}. ` +
        `Seed and publish first (npm run seed -- --publish).`,
    );
  }
  const {
    tree_id: treeId,
    version_seq: versionSeq,
    published_at: publishedAt,
  } = trees[0]!;
  return { treeId, versionSeq, publishedAt };
}

export async function fetchPublishedTreeMetadata(): Promise<PublishedTreeMeta> {
  return withDbRetry(selectPublishedTreeMeta);
}

export async function fetchTreeRows(treeId: string): Promise<TreeQueryRow[]> {
  return withDbRetry((sql) => selectTreeRows(sql, treeId));
}

export async function fetchPublishedTree(): Promise<TreePayload> {
  return withDbRetry(async (sql) => {
    const meta = await selectPublishedTreeMeta(sql);
    const rows = await selectTreeRows(sql, meta.treeId);
    return { ...meta, rows };
  });
}

export async function fetchTreeKind(
  treeId: string,
): Promise<"published" | "historical" | "sandbox" | null> {
  return withDbRetry(async (sql) => {
    const trees = await sql<{ kind: "published" | "historical" | "sandbox" }[]>`
      select kind from organelle.trees where tree_id = ${treeId}
    `;
    return trees[0]?.kind ?? null;
  });
}

/** Fetch any tree by id for sandbox share URLs. Returns null when the
 *  tree does not exist. Published/historical trees load fine too — the caller
 *  decides what is editable. */
export async function fetchTree(treeId: string): Promise<SandboxPayload | null> {
  return withDbRetry(async (sql) => {
    const trees = await sql<
      {
        tree_id: string;
        name: string | null;
        kind: "published" | "historical" | "sandbox";
        archived_at: string | null;
        owner_auth_id: string | null;
        version_seq: number | null;
        forked_from_seq: number | null;
        forked_from_tree_id: string | null;
      }[]
    >`
      select tree_id, name, kind, archived_at, owner_auth_id, version_seq,
             forked_from_seq, forked_from_tree_id
      from organelle.trees
      where tree_id = ${treeId}
    `;
    const tree = trees[0];
    if (!tree) return null;

    const rows = await selectTreeRows(sql, treeId);
    return {
      treeId,
      name: tree.name ?? "Tree",
      kind: tree.kind,
      archived: tree.archived_at !== null,
      ownerAuthId: tree.owner_auth_id,
      versionSeq: tree.version_seq,
      forkedFromSeq: tree.forked_from_seq ?? 0,
      forkedFromTreeId: tree.forked_from_tree_id,
      rows,
    };
  });
}
