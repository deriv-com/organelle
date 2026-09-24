/**
 * Flatten TreeQueryRow seats into MergeNode maps and back.
 */

import type { TreeQueryRow } from "@/features/chart/tree-query";

import type { MergeAssignment, MergeNode, OverrideMap } from "./types";

export function indexRows(rows: TreeQueryRow[]): MergeNode[] {
  const byId = new Map<string, MergeNode>();
  for (const row of rows) {
    let node = byId.get(row.node_id);
    if (!node) {
      node = {
        id: row.node_id,
        parentId: row.parent_node_id ?? "",
        kind: row.node_type,
        sortOrder: row.sort_order,
        rowVersion: row.row_version,
        name: row.name,
        jobTitle: row.job_title,
        positionLevel: row.position_level,
        isAssistant: Boolean(row.is_assistant),
        leafGridColumns: row.leaf_grid_columns ?? 3,
        assignments: [],
      };
      byId.set(row.node_id, node);
    }
    if (row.employee_auth_id) {
      node.assignments.push({
        employeeAuthId: row.employee_auth_id,
        isHost: row.is_host ?? false,
        isPrimary: row.is_primary ?? false,
        displayName: row.override_display_name ?? row.full_name ?? "Unknown",
        displayTitle: row.override_display_title ?? row.employee_job_title ?? "",
        email: row.email ?? "",
        avatarUrl: row.override_avatar_url ?? row.employee_avatar_url,
        officeLocation: row.office_location ?? "",
        status: row.status,
        joiningDate: row.joining_date,
      });
    }
  }
  for (const node of byId.values()) {
    node.assignments.sort((a, b) => Number(b.isHost) - Number(a.isHost));
  }
  return [...byId.values()];
}

export function overridesFromRows(rows: TreeQueryRow[]): OverrideMap {
  const map: OverrideMap = {};
  for (const row of rows) {
    if (!row.employee_auth_id) continue;
    if (row.override_auth_id == null) continue;
    if (map[row.employee_auth_id]) continue;
    map[row.employee_auth_id] = {
      nodeId: row.override_node_id ?? row.node_id,
      updatedBy: row.override_updated_by ?? null,
      updatedAt: row.override_updated_at ?? null,
      displayName: row.override_display_name,
      displayTitle: row.override_display_title,
      avatarUrl: row.override_avatar_url,
      legalFullName: row.override_legal_full_name ?? null,
      officeCountry: row.override_office_country ?? null,
      officeLocation: row.override_office_location ?? null,
      hiringCompany: row.override_hiring_company ?? null,
      status: row.override_status ?? null,
      joiningDate: row.override_joining_date ?? null,
      hiredAt: row.override_hired_at ?? null,
      resignationDate: row.override_resignation_date ?? null,
      lastWorkingDate: row.override_last_working_date ?? null,
      employeeId: row.override_external_id ?? null,
      employmentRecord: row.override_employment_record ?? null,
      positionLevel: row.override_position_level ?? null,
      primaryManagerAuthId: row.override_primary_manager_auth_id ?? null,
      primaryTeamPath: row.override_primary_team_path ?? null,
    };
  }
  return map;
}

/** Current global employee values, without applying a sandbox override. */
export function employeeDetailsFromRows(rows: TreeQueryRow[]): OverrideMap {
  const map: OverrideMap = {};
  for (const row of rows) {
    if (!row.employee_auth_id || map[row.employee_auth_id]) continue;
    map[row.employee_auth_id] = {
      nodeId: row.node_id,
      displayName: row.full_name,
      displayTitle: row.employee_job_title,
      avatarUrl: row.employee_avatar_url,
      legalFullName: row.legal_full_name ?? null,
      officeCountry: row.office_country ?? null,
      officeLocation: row.office_location,
      hiringCompany: row.hiring_company ?? null,
      status: row.status,
      joiningDate: row.joining_date,
      hiredAt: row.hired_at ?? null,
      resignationDate: row.resignation_date ?? null,
      lastWorkingDate: row.last_working_date ?? null,
      employeeId: row.external_id ?? null,
      employmentRecord: row.employment_record ?? null,
      positionLevel: row.employee_position_level ?? null,
      primaryManagerAuthId: row.primary_manager_auth_id ?? null,
      primaryTeamPath: row.primary_team_path ?? null,
    };
  }
  return map;
}

export function byId(nodes: MergeNode[]): Map<string, MergeNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

export function cloneNode(node: MergeNode): MergeNode {
  return { ...node, assignments: node.assignments.map((a) => ({ ...a })) };
}

export function nodeLabel(node: MergeNode | undefined, fallback = "this node"): string {
  if (!node) return fallback;
  if (node.kind === "header") return node.name ?? fallback;
  const host = node.assignments.find((a) => a.isHost) ?? node.assignments[0];
  return host?.displayName ?? node.jobTitle ?? fallback;
}

export function assignmentKey(nodeId: string, empId: string): string {
  return `${nodeId}:${empId}`;
}

export function toQueryRows(nodes: MergeNode[]): TreeQueryRow[] {
  const rows: TreeQueryRow[] = [];
  for (const node of nodes) {
    const base = {
      node_id: node.id,
      parent_node_id: node.parentId === "" ? null : node.parentId,
      node_type: node.kind,
      sort_order: node.sortOrder,
      row_version: node.rowVersion,
      name: node.name,
      job_title: node.jobTitle,
      position_level: node.positionLevel,
      is_assistant: node.isAssistant,
      leaf_grid_columns: node.leafGridColumns,
    };
    const members: MergeAssignment[] =
      node.assignments.length > 0
        ? node.assignments
        : [
            {
              employeeAuthId: "",
              isHost: null as unknown as boolean,
              displayName: "",
              displayTitle: "",
              email: "",
              avatarUrl: null,
              officeLocation: "",
              status: null,
              joiningDate: null,
            },
          ];
    for (const a of members) {
      rows.push({
        ...base,
        employee_auth_id: a.employeeAuthId || null,
        is_host: a.employeeAuthId ? a.isHost : null,
        is_primary: a.employeeAuthId ? Boolean(a.isPrimary) : null,
        full_name: a.employeeAuthId ? a.displayName : null,
        email: a.employeeAuthId ? a.email : null,
        employee_job_title: a.employeeAuthId ? a.displayTitle : null,
        employee_avatar_url: a.employeeAuthId ? a.avatarUrl : null,
        office_location: a.employeeAuthId ? a.officeLocation : null,
        status: a.employeeAuthId ? a.status : null,
        joining_date: a.employeeAuthId ? a.joiningDate : null,
        override_display_name: null,
        override_display_title: null,
        override_avatar_url: null,
      });
    }
  }
  return rows;
}
