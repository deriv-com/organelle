/**
 * Merge engine types. Pure data — no I/O.
 */

export const MAX_DEPTH = 16;

export type ConflictKind =
  | "concurrent_move"
  | "stale_target"
  | "stale_source"
  | "concurrent_edit"
  | "combo_cycle"
  | "combo_depth"
  | "combo_orphan"
  | "combo_root";

export type ResolutionChoice =
  "use_live" | "use_sandbox" | "drop" | "pick_new_target" | "recreate";

export type Resolution =
  | { choice: "use_live" | "use_sandbox" | "drop" }
  | { choice: "pick_new_target"; newParentId: string }
  | { choice: "recreate" };

export type MergeAssignment = {
  employeeAuthId: string;
  isHost: boolean;
  isPrimary?: boolean;
  displayName: string;
  displayTitle: string;
  email: string;
  avatarUrl: string | null;
  officeLocation: string;
  status: "joining" | "active" | "serving_notice" | "inactive" | "resigned" | null;
  joiningDate: string | null;
};

export type MergeNode = {
  id: string;
  parentId: string | "";
  kind: "header" | "seat";
  sortOrder: number;
  rowVersion: number;
  name: string | null;
  jobTitle: string | null;
  positionLevel: number | null;
  isAssistant: boolean;
  leafGridColumns: number;
  assignments: MergeAssignment[];
};

export type OverrideTriple = {
  nodeId?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
  displayName: string | null;
  displayTitle: string | null;
  avatarUrl: string | null;
  legalFullName?: string | null;
  officeCountry?: string | null;
  officeLocation?: string | null;
  hiringCompany?: string | null;
  status?: "joining" | "active" | "serving_notice" | "inactive" | "resigned" | null;
  joiningDate?: string | null;
  hiredAt?: string | null;
  resignationDate?: string | null;
  lastWorkingDate?: string | null;
  employeeId?: string | null;
  employmentRecord?: string | null;
  positionLevel?: number | null;
  primaryManagerAuthId?: string | null;
  primaryTeamPath?: string | null;
};

export type OverrideMap = Record<string, OverrideTriple>;

export type AutoChangeKind =
  "create" | "delete" | "move" | "edit" | "assign" | "unassign" | "peer" | "reorder";

export type AutoChange = {
  key: string;
  nodeId: string;
  kind: AutoChangeKind;
  summary: string;
  fieldChanges?: EmployeeFieldChange[];
  employee?: {
    name: string;
    avatarUrl: string | null;
    actorName: string | null;
    updatedAt: string | null;
  };
};

export type EmployeeFieldChange = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

export type ConflictSide = {
  exists: boolean;
  parentLabel: string | null;
  title: string | null;
};

export function formatConflictSide(side: ConflictSide): string {
  if (!side.exists) return "Deleted";
  const parts = ["Still exists"];
  if (side.parentLabel) parts.push(`Under ${side.parentLabel}`);
  if (side.title) parts.push(side.title);
  return parts.join(" · ");
}

export type Conflict = {
  key: string;
  kind: ConflictKind;
  nodeId: string;
  field: string;
  sentence: string;
  label: string;
  live: ConflictSide;
  sandbox: ConflictSide;
  allowed: ResolutionChoice[];
  relatedId?: string;
};

export type MergeCounts = {
  moves: number;
  edits: number;
  creates: number;
  deletes: number;
  peers: number;
};

export type MergeLog = {
  op: string;
  nodeId: string | null;
  employeeAuthId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export type MergeTarget = "published" | "sandbox";

export type MergeSnapshot = {
  direction: MergeTarget;
  expectedLiveSeq: number;
  expectedNodeVersions: Record<string, number>;
  nodes: Array<{
    node_id: string;
    parent_node_id: string | null;
    node_type: "header" | "seat";
    sort_order: number;
    name: string | null;
    job_title: string | null;
    position_level: number | null;
    is_assistant: boolean;
    leaf_grid_columns: number;
  }>;
  assignments: Array<{
    node_id: string;
    employee_auth_id: string;
    is_host: boolean;
    is_primary: boolean;
  }>;
  employeeOverrides: Array<{
    auth_id: string;
    node_id: string | null;
    display_name: string | null;
    display_title: string | null;
    avatar_url: string | null;
    legal_full_name: string | null;
    office_country: string | null;
    office_location: string | null;
    hiring_company: string | null;
    status: "joining" | "active" | "serving_notice" | "inactive" | "resigned" | null;
    joining_date: string | null;
    hired_at: string | null;
    resignation_date: string | null;
    last_working_date: string | null;
    external_id: string | null;
    employment_record: string | null;
    position_level: number | null;
    primary_manager_auth_id: string | null;
    primary_team_path: string | null;
  }>;
  logs: MergeLog[];
};

export type MergeInput = {
  base: MergeNode[];
  live: MergeNode[];
  sandbox: MergeNode[];
  liveSeq: number;
  forkedFromSeq: number;
  target?: MergeTarget;
  resolutions?: Record<string, Resolution>;
  includedKeys?: string[] | null;
  baseOverrides?: OverrideMap;
  liveOverrides?: OverrideMap;
  sandboxOverrides?: OverrideMap;
  liveEmployeeDetails?: OverrideMap;
};

export type MergeResult = {
  zeroDrift: boolean;
  drift: boolean;
  changes: AutoChange[];
  conflicts: Conflict[];
  unresolved: Conflict[];
  graphConflicts: Conflict[];
  merged: MergeNode[];
  valid: boolean;
  counts: MergeCounts;
  snapshot: MergeSnapshot;
  tints: {
    added: string[];
    removed: string[];
    moved: string[];
    edited: string[];
  };
};

export const RESOLUTION_LABELS: Record<
  ResolutionChoice,
  { label: string; tooltip: string }
> = {
  use_live: {
    label: "Live chart",
    tooltip: "Keep the live-chart side of this conflict.",
  },
  use_sandbox: {
    label: "Sandbox",
    tooltip: "Apply the sandbox side of this conflict.",
  },
  drop: {
    label: "Skip",
    tooltip: "Leave live as-is. This change stays out of the merge.",
  },
  pick_new_target: {
    label: "Pick a new parent",
    tooltip: "The team or manager this moved under is gone. Choose a new destination.",
  },
  recreate: {
    label: "Keep the sandbox node",
    tooltip: "Live deleted this node. Restore it from the sandbox.",
  },
};

export const ALLOWED: Record<
  "concurrent_move" | "stale_target" | "stale_source" | "concurrent_edit",
  ResolutionChoice[]
> = {
  concurrent_move: ["use_live", "use_sandbox", "drop"],
  stale_target: ["pick_new_target", "drop"],
  stale_source: ["recreate", "drop"],
  concurrent_edit: ["use_live", "use_sandbox", "drop"],
};
