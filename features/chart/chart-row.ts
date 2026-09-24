/**
 * ChartRow builder.
 *
 * Hard rules encoded here:
 * - `id` is `node_id`, always. No synthetic or name-derived ids.
 * - Never repair the graph. A cycle, orphan, dangling parent, or wrong root count
 *   means the write path is broken — throw loudly, do not prune.
 * - Display fields resolve scoped employee override ?? employees.*.
 * - members[0] is the host (the query orders host-first; preserved here).
 */

import type { TreeQueryRow } from "./tree-query";
import { assignDeptColors } from "./dept-color";

/** Exact member DTO shipped on published chart/directory/version snapshots. */
export interface PublicSeatMember {
  authId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  officeLocation: string;
  status: "joining" | "active" | "serving_notice" | "inactive" | "resigned";
  joiningDate: string | null;
  isHost: boolean;
  isPrimary?: boolean;
  /** Derived display rule; keeps the exact position level out of read-only payloads. */
  servingNoticeMuted?: boolean;
}

/** Sandbox/editor member shape. These fields never cross a read-only API boundary. */
export interface EditorSeatMember extends PublicSeatMember {
  displayTitle: string;
  sourceName: string;
  sourceTitle: string;
  sourceAvatarUrl: string | null;
  overrideName: string | null;
  overrideTitle: string | null;
  overrideAvatarUrl: string | null;
  legalFullName?: string | null;
  employeeId?: string | null;
  employmentRecord?: string | null;
  positionLevel?: number | null;
  officeCountry?: string | null;
  hiringCompany?: string | null;
  hiredAt?: string | null;
  resignationDate?: string | null;
  lastWorkingDate?: string | null;
  primaryManagerAuthId?: string | null;
  primaryTeamPath?: string | null;
}

/** Full member shape from buildChart; alias kept for call-site compatibility. */
export type SeatMember = EditorSeatMember;

export const EDITOR_ONLY_MEMBER_KEYS = [
  "displayTitle",
  "sourceName",
  "sourceTitle",
  "sourceAvatarUrl",
  "overrideName",
  "overrideTitle",
  "overrideAvatarUrl",
  "legalFullName",
  "employeeId",
  "employmentRecord",
  "positionLevel",
  "officeCountry",
  "hiringCompany",
  "hiredAt",
  "resignationDate",
  "lastWorkingDate",
  "primaryManagerAuthId",
  "primaryTeamPath",
] as const;

export const EDITOR_ONLY_ROW_KEYS = [
  "rowVersion",
  "jobTitle",
  "positionLevel",
] as const;

export function toPublicMember(member: EditorSeatMember): PublicSeatMember {
  return {
    authId: member.authId,
    displayName: member.displayName,
    email: member.email,
    avatarUrl: member.avatarUrl,
    officeLocation: member.officeLocation,
    status: member.status,
    joiningDate: member.joiningDate,
    isHost: member.isHost,
    servingNoticeMuted: shouldMuteServingNotice(member.status, member.positionLevel),
    ...(member.isPrimary !== undefined ? { isPrimary: member.isPrimary } : {}),
  };
}

export function shouldMuteServingNotice(
  status: PublicSeatMember["status"],
  positionLevel: number | null | undefined,
): boolean {
  return status === "serving_notice" && (positionLevel == null || positionLevel < 5);
}

export function hydratePublicMember(member: PublicSeatMember): SeatMember {
  return {
    ...member,
    displayTitle: "",
    sourceName: "",
    sourceTitle: "",
    sourceAvatarUrl: null,
    overrideName: null,
    overrideTitle: null,
    overrideAvatarUrl: null,
  };
}

/** Exact row DTO shipped on published/historical chart APIs. */
export interface PublicChartRow {
  id: string;
  parentId: string | "";
  kind: "header" | "seat";
  sortOrder: number;
  isAssistant?: boolean;
  leafGridColumns?: number;
  name?: string;
  members: PublicSeatMember[];
}

export function toPublicChartRows(rows: ChartRow[]): PublicChartRow[] {
  return rows.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    kind: row.kind,
    sortOrder: row.sortOrder,
    ...(row.isAssistant !== undefined ? { isAssistant: row.isAssistant } : {}),
    ...(row.leafGridColumns !== undefined
      ? { leafGridColumns: row.leafGridColumns }
      : {}),
    ...(row.name !== undefined ? { name: row.name } : {}),
    members: row.members.map(toPublicMember),
  }));
}

/**
 * Read-only screens share the editor-oriented ChartRow renderer. Hydrate inert values for
 * fields that renderer never reads outside a sandbox; hidden source values stay server-side.
 */
export function hydratePublicChartRows(rows: PublicChartRow[]): ChartRow[] {
  return rows.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    kind: row.kind,
    sortOrder: row.sortOrder,
    rowVersion: 0,
    ...(row.isAssistant !== undefined ? { isAssistant: row.isAssistant } : {}),
    ...(row.leafGridColumns !== undefined
      ? { leafGridColumns: row.leafGridColumns }
      : {}),
    ...(row.name !== undefined ? { name: row.name } : {}),
    members: row.members.map(hydratePublicMember),
  }));
}

export interface ChartRow {
  id: string;
  parentId: string | "";
  kind: "header" | "seat";
  sortOrder: number;
  /** Optimistic-concurrency token for drags. */
  rowVersion: number;
  /** Seat layout flag: drawn on the parent's trunk, not in the child row. */
  isAssistant?: boolean;
  /** Parent layout: max columns for leaf-seat grid (1–5, default 3). */
  leafGridColumns?: number;
  name?: string;
  jobTitle?: string;
  positionLevel?: number;
  members: SeatMember[];
  // d3-org-chart runtime state: exactly these fields survive a structural rebuild.
  _expanded?: boolean;
  _pagingStep?: number;
  // Transient: set by search focus so the next render centres on this node.
  // The library clears it after centring; never carried across rebuilds.
  _centered?: boolean;
  // Annotated by d3-org-chart (setLayouts) on the row objects during render.
  _directSubordinates?: number;
  _totalSubordinates?: number;
}

export interface ChartIndex {
  rootId: string;
  childrenById: Map<string, ChartRow[]>;
  depthById: Map<string, number>;
  /** Top-level department header node_id the node descends from; null for the
   *  root and for seats reporting directly to it. Drives the subtree colour family. */
  deptById: Map<string, string | null>;
  /** Resolved family colour hex for each node (root family omitted — callers use
   *  the neutral fallback). */
  deptColorById: Map<string, string>;
}

export class ChartDataError extends Error {}

export function buildChart(queryRows: TreeQueryRow[]): {
  rows: ChartRow[];
  index: ChartIndex;
} {
  const rowsById = new Map<string, ChartRow>();
  for (const row of queryRows) {
    let chartRow = rowsById.get(row.node_id);
    if (!chartRow) {
      chartRow = {
        id: row.node_id,
        parentId: row.parent_node_id ?? "",
        kind: row.node_type,
        sortOrder: row.sort_order,
        rowVersion: row.row_version,
        ...(row.leaf_grid_columns !== 3
          ? { leafGridColumns: row.leaf_grid_columns }
          : {}),
        ...(row.is_assistant ? { isAssistant: true } : {}),
        ...(row.node_type === "header" ? { name: row.name ?? undefined } : {}),
        ...(row.node_type === "seat"
          ? {
              jobTitle: row.job_title ?? undefined,
              positionLevel: row.position_level ?? undefined,
            }
          : {}),
        members: [],
      };
      rowsById.set(row.node_id, chartRow);
    }
    const hasEmployeeOverride = row.override_auth_id != null;
    const status = hasEmployeeOverride
      ? (row.override_status ?? "active")
      : (row.status ?? "active");
    if (row.employee_auth_id && status !== "inactive" && status !== "resigned") {
      const positionLevel = hasEmployeeOverride
        ? row.override_position_level
        : row.employee_position_level;
      chartRow.members.push({
        authId: row.employee_auth_id,
        displayName: hasEmployeeOverride
          ? (row.override_display_name ?? "Unknown")
          : (row.full_name ?? "Unknown"),
        displayTitle: hasEmployeeOverride
          ? (row.override_display_title ?? "")
          : (row.employee_job_title ?? ""),
        email: row.email ?? "",
        avatarUrl: hasEmployeeOverride
          ? (row.override_avatar_url ?? null)
          : row.employee_avatar_url,
        officeLocation: hasEmployeeOverride
          ? (row.override_office_location ?? "")
          : (row.office_location ?? ""),
        status,
        joiningDate: hasEmployeeOverride
          ? (row.override_joining_date ?? null)
          : row.joining_date,
        isHost: row.is_host ?? false,
        isPrimary: row.is_primary ?? false,
        servingNoticeMuted: shouldMuteServingNotice(status, positionLevel),
        sourceName: row.full_name ?? "Unknown",
        sourceTitle: row.employee_job_title ?? "",
        sourceAvatarUrl: row.employee_avatar_url,
        overrideName: hasEmployeeOverride ? row.override_display_name : null,
        overrideTitle: hasEmployeeOverride ? row.override_display_title : null,
        overrideAvatarUrl: hasEmployeeOverride ? row.override_avatar_url : null,
        legalFullName: hasEmployeeOverride
          ? row.override_legal_full_name
          : row.legal_full_name,
        employeeId: hasEmployeeOverride ? row.override_external_id : row.external_id,
        employmentRecord: hasEmployeeOverride
          ? row.override_employment_record
          : row.employment_record,
        positionLevel,
        officeCountry: hasEmployeeOverride
          ? row.override_office_country
          : row.office_country,
        hiringCompany: hasEmployeeOverride
          ? row.override_hiring_company
          : row.hiring_company,
        hiredAt: hasEmployeeOverride ? row.override_hired_at : row.hired_at,
        resignationDate: hasEmployeeOverride
          ? row.override_resignation_date
          : row.resignation_date,
        lastWorkingDate: hasEmployeeOverride
          ? row.override_last_working_date
          : row.last_working_date,
        primaryManagerAuthId: hasEmployeeOverride
          ? row.override_primary_manager_auth_id
          : row.primary_manager_auth_id,
        primaryTeamPath: hasEmployeeOverride
          ? row.override_primary_team_path
          : row.primary_team_path,
      });
    }
  }

  const rows = [...rowsById.values()];
  const index = indexFromRows(rows);
  return { rows: orderRows(rows, index), index };
}

export function filterVisibleChartMembers(rows: ChartRow[]): ChartRow[] {
  return rows.map((row) => {
    const members = row.members.filter(
      (member) => member.status !== "inactive" && member.status !== "resigned",
    );
    return members.length === row.members.length ? row : { ...row, members };
  });
}

/**
 * Validate ChartRows and derive the render index. Runs server-side via buildChart
 * and again client-side from the serialized rows — invalid graphs throw in both
 * places.
 */
export function indexFromRows(rows: ChartRow[]): ChartIndex {
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  for (const row of rows) {
    if (row.parentId !== "" && !rowsById.has(row.parentId)) {
      throw new ChartDataError(
        `node ${row.id} has dangling parent ${row.parentId} — write-path validation bug`,
      );
    }
  }

  const roots = rows.filter((row) => row.parentId === "");
  if (roots.length !== 1) {
    throw new ChartDataError(
      `expected exactly one root, found ${roots.length} — write-path validation bug`,
    );
  }
  const rootId = roots[0]!.id;

  const childrenById = new Map<string, ChartRow[]>();
  for (const row of rows) {
    if (row.parentId === "") continue;
    const siblings = childrenById.get(row.parentId) ?? [];
    siblings.push(row);
    childrenById.set(row.parentId, siblings);
  }
  for (const children of childrenById.values()) {
    children.sort((a, b) => {
      if (Boolean(a.isAssistant) !== Boolean(b.isAssistant)) {
        return a.isAssistant ? -1 : 1;
      }
      return a.sortOrder - b.sortOrder;
    });
  }

  // Walk from the root; anything unreached is orphaned or inside a cycle.
  const depthById = new Map<string, number>([[rootId, 1]]);
  const deptById = new Map<string, string | null>([[rootId, null]]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const depth = depthById.get(id)!;
    const row = rowsById.get(id)!;
    // The node's own colour family: a top-level header starts one; everything
    // else inherits its parent's.
    const ownDept =
      depth === 2 && row.kind === "header" ? row.id : (deptById.get(id) ?? null);
    deptById.set(id, depth === 1 ? null : ownDept);
    for (const child of childrenById.get(id) ?? []) {
      if (depthById.has(child.id)) {
        throw new ChartDataError(
          `cycle through node ${child.id} — write-path validation bug`,
        );
      }
      depthById.set(child.id, depth + 1);
      deptById.set(child.id, ownDept);
      queue.push(child.id);
    }
  }
  if (depthById.size !== rows.length) {
    const unreached = rows.filter((row) => !depthById.has(row.id)).map((row) => row.id);
    throw new ChartDataError(
      `${unreached.length} nodes unreachable from root (orphan or cycle): ${unreached.slice(0, 5).join(", ")}…`,
    );
  }

  const deptHeaderIds = [
    ...new Set([...deptById.values()].filter((id): id is string => id !== null)),
  ];
  const assigned = assignDeptColors(deptHeaderIds);
  const deptColorById = new Map<string, string>();
  for (const [nodeId, deptId] of deptById) {
    if (!deptId) continue;
    const hex = assigned.get(deptId);
    if (hex) deptColorById.set(nodeId, hex);
  }

  return { rootId, childrenById, depthById, deptById, deptColorById };
}

/**
 * DFS pre-order following each parent's sortOrder. d3 stratify preserves
 * data-array order for children, so this is the on-screen sibling order.
 * Optimistic applies must re-emit this before the chart sees the rows.
 */
export function orderRows(rows: ChartRow[], index = indexFromRows(rows)): ChartRow[] {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const ordered: ChartRow[] = [];
  const visit = (id: string) => {
    const row = rowsById.get(id);
    if (!row) return;
    ordered.push(row);
    for (const child of index.childrenById.get(id) ?? []) visit(child.id);
  };
  visit(index.rootId);
  return ordered;
}

/** Direct children that sit in the team row (not the trunk assistant). */
export function teamChildren(index: ChartIndex, parentId: string): ChartRow[] {
  return (index.childrenById.get(parentId) ?? []).filter((child) => !child.isAssistant);
}

/**
 * Unique visible employees in descendant seats — expand-all chip count.
 * Headers and vacant seats are skipped; multi-role people count once.
 */
export function descendantEmployeeCount(index: ChartIndex, nodeId: string): number {
  const employeeIds = new Set<string>();
  const walk = (id: string) => {
    for (const child of index.childrenById.get(id) ?? []) {
      if (child.kind === "seat") {
        for (const member of child.members) employeeIds.add(member.authId);
      }
      walk(child.id);
    }
  };
  walk(nodeId);
  return employeeIds.size;
}

/** Direct child nodes — headers, seats, assistants, and vacant seats included. */
export function directChildNodeCount(index: ChartIndex, parentId: string): number {
  return (index.childrenById.get(parentId) ?? []).length;
}

/** Unique employees present in the supplied chart rows. */
export function uniqueEmployeeCount(rows: ChartRow[]): number {
  return new Set(rows.flatMap((row) => row.members.map((member) => member.authId)))
    .size;
}

export function assistantChild(
  index: ChartIndex,
  parentId: string,
): ChartRow | undefined {
  return (index.childrenById.get(parentId) ?? []).find((child) => child.isAssistant);
}
