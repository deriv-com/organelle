import type { AuditScope } from "./filters";

export type AuditEvent = {
  id: string;
  createdAt: string;
  op: string;
  actorAuthId: string;
  actorName: string | null;
  actorEmail: string | null;
  actorAvatarUrl: string | null;
  targetEmployeeAuthId: string | null;
  targetEmployeeName: string | null;
  targetEmployeeEmail: string | null;
  treeId: string | null;
  nodeId: string | null;
  nodeName: string | null;
  nodeJobTitle: string | null;
  treeKind: string | null;
  treeName: string | null;
  versionSeq: number | null;
  mergeId: string | null;
  commandId: string | null;
  commandKind: string | null;
  undoesCommandId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export type AuditMetadata = Record<string, unknown>;

export type AuditDisplay = {
  opLabel: string;
  actionLabel: string;
  summary: string;
  actorLabel: string;
  actorSubLabel: string | null;
  scopeLabel: string;
  scopeDetail: string | null;
  metadata: AuditMetadata;
  preview: Array<{ label: string; value: string }>;
};

const OP_LABELS: Record<string, string> = {
  create_header: "Create",
  rename_header: "Rename",
  delete_header: "Remove",
  create_seat: "Create",
  delete_seat: "Remove",
  move_node: "Move",
  set_assistant: "Placement",
  set_leaf_grid_columns: "Layout",
  reorder_node: "Move",
  assign_employee: "Peer",
  unassign_employee: "Peer",
  set_peer_host: "Peer",
  set_override: "Update",
  clear_override: "Update",
  update_employee: "Update",
  set_primary_seat: "Primary",
  rename_seat: "Rename",
  grant_role: "Role",
  revoke_role: "Role",
  grant_sandbox_access: "Access",
  change_sandbox_access: "Access",
  revoke_sandbox_access: "Access",
  expire_sandbox_access: "Access",
  fork_sandbox: "Create",
  merge_sandbox: "Merge",
  sync_from_live: "Sync",
  restore_version: "Restore",
};

const ACTION_LABELS: Record<string, string> = {
  create_header: "Created team",
  rename_header: "Renamed team",
  delete_header: "Removed team",
  create_seat: "Created position",
  delete_seat: "Removed position",
  move_node: "Moved employee",
  set_assistant: "Changed placement",
  set_leaf_grid_columns: "Changed layout",
  reorder_node: "Reordered item",
  assign_employee: "Added peer",
  unassign_employee: "Removed peer",
  set_peer_host: "Changed primary host",
  set_override: "Updated details",
  clear_override: "Cleared override",
  update_employee: "Updated employee",
  set_primary_seat: "Changed primary seat",
  rename_seat: "Renamed position",
  grant_role: "Granted role",
  revoke_role: "Revoked role",
  grant_sandbox_access: "Granted sandbox access",
  change_sandbox_access: "Changed sandbox access",
  revoke_sandbox_access: "Revoked sandbox access",
  expire_sandbox_access: "Expired sandbox access",
  fork_sandbox: "Forked sandbox",
  merge_sandbox: "Merged sandbox",
  sync_from_live: "Synced from live",
  restore_version: "Restored version",
};

const FIELD_LABELS: Record<string, string> = {
  email: "Email",
  full_name: "Full name",
  legal_full_name: "Legal name",
  id: "Employee ID",
  employment_record: "Employment record",
  job_title: "Job title",
  position_level: "Position level",
  avatar_url: "Avatar URL",
  office_country: "Office country",
  office_location: "Office location",
  hiring_company: "Hiring company",
  status: "Status",
  joining_date: "Joining date",
  hired_at: "Hired date",
  resignation_date: "Resignation date",
  last_working_date: "Last working date",
  display_name: "Display name",
  display_title: "Display title",
  role: "Role",
  name: "Name",
};

const VALUE_LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  joining: "Joining",
  resigned: "Resigned",
  serving_notice: "Serving Notice",
  viewer: "Viewer",
  developer: "Developer",
  editor: "Editor",
  admin: "Admin",
  publisher: "Publisher",
};

function humaniseToken(value: string): string {
  const label = VALUE_LABELS[value];
  if (label) return label;
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(value)) return value;
  return value
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function valueLabel(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Blank";
  return humaniseToken(String(value));
}

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replaceAll("_", " ");
}

function changedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  const previous = before ?? {};
  const next = after ?? {};
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])]
    .filter((key) => valueLabel(previous[key]) !== valueLabel(next[key]))
    .map(fieldLabel);
}

function targetLabel(event: AuditEvent): string {
  const employee = event.targetEmployeeName?.trim();
  if (employee) return employee;
  const node = event.nodeName?.trim() || event.nodeJobTitle?.trim();
  if (node) return node;
  const after = event.after ?? {};
  const before = event.before ?? {};
  const fallback = after.name ?? after.job_title ?? before.name ?? before.job_title;
  if (fallback) return String(fallback);
  return "Unknown target";
}

function roleSummary(event: AuditEvent): string {
  const role = valueLabel(event.after?.role ?? event.before?.role);
  return `${ACTION_LABELS[event.op] ?? "Changed role"}: ${targetLabel(event)} as ${role}`;
}

function employeeSummary(event: AuditEvent): string {
  const fields = changedFields(event.before, event.after);
  const suffix =
    fields.length > 0
      ? ` (${fields.slice(0, 3).join(", ")}${fields.length > 3 ? ` +${fields.length - 3}` : ""})`
      : "";
  return `${ACTION_LABELS[event.op] ?? "Updated employee"}: ${targetLabel(event)}${suffix}`;
}

function structuralSummary(event: AuditEvent): string {
  const action = ACTION_LABELS[event.op] ?? humaniseToken(event.op);
  return `${action}: ${targetLabel(event)}`;
}

function scopeLabelFor(event: AuditEvent): string {
  if (event.treeKind === null) return "Deleted tree";
  if (event.treeKind === "sandbox") return "Sandbox";
  if (event.treeKind === "published") return "Published";
  if (event.treeKind === "historical") return "Historical";
  return humaniseToken(event.treeKind);
}

function scopeDetailFor(event: AuditEvent): string | null {
  if (event.treeKind === "sandbox") return event.treeName || null;
  if (event.versionSeq !== null) return `v${event.versionSeq}`;
  return event.treeName || null;
}

function setMetadataValue(metadata: AuditMetadata, key: string, value: unknown): void {
  if (value === null || value === undefined || value === "") return;
  metadata[key] = value;
}

function personLabel(name: string | null, email: string | null): string | null {
  const cleanName = name?.trim();
  const cleanEmail = email?.trim();
  if (cleanName && cleanEmail) return `${cleanName} <${cleanEmail}>`;
  return cleanName || cleanEmail || null;
}

function compactChartContextLabel(event: AuditEvent): string | null {
  const scope = scopeLabelFor(event);
  const detail = scopeDetailFor(event);
  return [scope, detail].filter(Boolean).join(" ") || null;
}

function auditMetadata(event: AuditEvent): AuditMetadata {
  const metadata: AuditMetadata = {
    audit_id: event.id,
    operation: event.op,
    operation_label: operationActionLabel(event.op),
  };

  setMetadataValue(
    metadata,
    "performed_by",
    personLabel(event.actorName, event.actorEmail),
  );
  setMetadataValue(
    metadata,
    "target",
    personLabel(event.targetEmployeeName, event.targetEmployeeEmail),
  );
  setMetadataValue(metadata, "node_label", event.nodeName ?? event.nodeJobTitle);
  setMetadataValue(metadata, "chart_context", compactChartContextLabel(event));
  setMetadataValue(metadata, "created_at", event.createdAt);
  setMetadataValue(metadata, "merge_id", event.mergeId);
  setMetadataValue(metadata, "command_id", event.commandId);
  setMetadataValue(metadata, "command_kind", event.commandKind);
  setMetadataValue(metadata, "before", event.before);
  setMetadataValue(metadata, "after", event.after);

  return metadata;
}

function metadataPreview(event: AuditEvent): Array<{ label: string; value: string }> {
  const target = targetLabel(event);
  const chartContext = [scopeLabelFor(event), scopeDetailFor(event)]
    .filter(Boolean)
    .join(" ");
  const lines = [
    target !== "Unknown target" ? { label: "Target", value: target } : null,
    chartContext ? { label: "Chart context", value: chartContext } : null,
    event.nodeName || event.nodeJobTitle
      ? { label: "Node", value: event.nodeName ?? event.nodeJobTitle ?? "" }
      : null,
    { label: "Operation", value: operationActionLabel(event.op) },
  ];
  return lines.filter((line): line is { label: string; value: string } =>
    Boolean(line),
  );
}

export function operationLabel(op: string): string {
  return OP_LABELS[op] ?? humaniseToken(op);
}

export function operationActionLabel(op: string): string {
  return ACTION_LABELS[op] ?? humaniseToken(op);
}

export function formatAuditEvent(event: AuditEvent): AuditDisplay {
  const actorName = event.actorName?.trim() || "Unknown actor";
  const actorEmail = event.actorEmail?.trim() || null;
  const summary =
    event.op === "grant_role" || event.op === "revoke_role"
      ? roleSummary(event)
      : event.op === "update_employee" ||
          event.op === "set_override" ||
          event.op === "clear_override"
        ? employeeSummary(event)
        : structuralSummary(event);

  return {
    opLabel: operationLabel(event.op),
    actionLabel: operationActionLabel(event.op),
    summary,
    actorLabel: actorName,
    actorSubLabel: actorEmail,
    scopeLabel: scopeLabelFor(event),
    scopeDetail: scopeDetailFor(event),
    metadata: auditMetadata(event),
    preview: metadataPreview(event),
  };
}

export function auditScopeLabel(scope: AuditScope): string {
  if (scope === "sandbox") return "Sandbox";
  if (scope === "all") return "All";
  return "Published";
}
