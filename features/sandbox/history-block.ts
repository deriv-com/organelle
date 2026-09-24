/**
 * History block shape. Pure — unit-tested.
 */

import type { ChartRow } from "@/features/chart/chart-row";
import { representativeLogRow } from "./command-stack";

export type HistoryRow = {
  id: string;
  op: string;
  node_id: string | null;
  employee_auth_id: string | null;
  employee_name?: string | null;
  employee_avatar_url?: string | null;
  actor_name?: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
  command_id?: string | null;
  command_kind?: "user" | "undo" | "redo" | null;
  undoes_command_id?: string | null;
};

export const OP_KIND: Record<string, string> = {
  fork_sandbox: "Created",
  sync_from_live: "Synced from live",
  move_node: "Move",
  reorder_node: "Reorder",
  assign_employee: "Peer added",
  unassign_employee: "Peer removed",
  create_header: "Team created",
  create_seat: "Position created",
  rename_header: "Renamed",
  delete_header: "Removed",
  delete_seat: "Removed",
  set_peer_host: "Host changed",
  set_assistant: "Assistant",
  set_leaf_grid_columns: "Columns",
  set_override: "Override",
  clear_override: "Override cleared",
  update_employee: "Employee updated",
  rename_seat: "Position renamed",
  set_primary_seat: "Primary seat",
  grant_sandbox_access: "Access granted",
  change_sandbox_access: "Access changed",
  revoke_sandbox_access: "Access removed",
  expire_sandbox_access: "Access expired",
};

export type Chip =
  | { type: "person"; name: string; avatarUrl: string | null }
  | { type: "team"; name: string; dept: string | null };

export type HistoryDetail = {
  label: string;
  chips: Chip[];
  afterChips?: Chip[];
  tags?: string[];
  text?: string;
};

export type HistoryBlock = {
  id: string;
  createdAt: string;
  op: string;
  kind: string;
  action: string;
  actorName: string | null;
  focusNodeId: string | null;
  subject: Chip[];
  details: HistoryDetail[];
};

function rowById(rows: ChartRow[], id: string | null): ChartRow | undefined {
  if (!id) return undefined;
  return rows.find((row) => row.id === id);
}

function deptFor(rows: ChartRow[], nodeId: string | null): string | null {
  if (!nodeId) return null;
  const byId = new Map(rows.map((row) => [row.id, row]));
  let cursor = byId.get(nodeId);
  let lastHeader: ChartRow | null = null;
  while (cursor) {
    if (cursor.kind === "header") lastHeader = cursor;
    if (!cursor.parentId) break;
    cursor = byId.get(cursor.parentId);
  }
  return lastHeader && lastHeader.parentId !== "" ? lastHeader.id : null;
}

function nodeChip(
  rows: ChartRow[],
  nodeId: string | null,
  fallback?: Record<string, unknown> | null,
  employeeInfo?: {
    authId?: string | null;
    name?: string | null;
    avatarUrl?: string | null;
  },
): Chip {
  const row = rowById(rows, nodeId);
  if (row) {
    if (row.kind === "header") {
      return { type: "team", name: row.name ?? "a team", dept: deptFor(rows, row.id) };
    }
    const host = row.members[0];
    if (host)
      return { type: "person", name: host.displayName, avatarUrl: host.avatarUrl };
    return {
      type: "team",
      name: row.jobTitle ?? "a seat",
      dept: deptFor(rows, row.id),
    };
  }
  if (employeeInfo?.name) {
    return {
      type: "person",
      name: employeeInfo.name,
      avatarUrl: employeeInfo.avatarUrl ?? null,
    };
  }
  if (employeeInfo?.authId) {
    const person = personChip(rows, employeeInfo.authId);
    if (person.name !== "someone") return person;
  }
  if (Array.isArray(fallback?.members) && fallback.members.length > 0) {
    const person = personChip(rows, String(fallback.members[0]));
    if (person.name !== "someone") return person;
  }
  if (fallback?.name) {
    return { type: "team", name: String(fallback.name), dept: null };
  }
  if (fallback?.job_title) {
    return { type: "team", name: String(fallback.job_title), dept: null };
  }
  return { type: "team", name: "a removed node", dept: null };
}

function personChip(
  rows: ChartRow[],
  authId: string | null,
  fallbackName?: string | null,
  fallbackAvatar?: string | null,
): Chip {
  if (fallbackName) {
    return { type: "person", name: fallbackName, avatarUrl: fallbackAvatar ?? null };
  }
  if (!authId) return { type: "person", name: "someone", avatarUrl: null };
  for (const row of rows) {
    const member = row.members.find((item) => item.authId === authId);
    if (member)
      return { type: "person", name: member.displayName, avatarUrl: member.avatarUrl };
  }
  return { type: "person", name: "someone", avatarUrl: null };
}

function detail(
  label: string,
  chips: Chip[] = [],
  text?: string | null,
): HistoryDetail | null {
  const value = text?.trim();
  if (chips.length === 0 && !value) return null;
  return { label, chips, ...(value ? { text: value } : {}) };
}

function chipDiff(
  label: string,
  beforeChips: Chip[],
  afterChips: Chip[],
): HistoryDetail | null {
  if (beforeChips.length === 0 && afterChips.length === 0) return null;
  return { label, chips: beforeChips, afterChips };
}

function compactDetails(details: Array<HistoryDetail | null>): HistoryDetail[] {
  return details.filter((item): item is HistoryDetail => item !== null);
}

const VALUE_LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  joining: "Joining",
  resigned: "Resigned",
  serving_notice: "Serving Notice",
};

function textValue(value: unknown, fallback = "Blank"): string {
  if (value === null || value === undefined || value === "") return fallback;
  const text = String(value);
  const label = VALUE_LABELS[text];
  if (label) return label;
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(text)) return text;
  return text
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function fieldChange(before: unknown, after: unknown): string | null {
  const previous = textValue(before);
  const next = textValue(after);
  if (previous === next) return null;
  return `${previous} → ${next}`;
}

function placementLabel(value: unknown): string {
  return value ? "Assistant" : "In team";
}

function ordinal(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `#${value + 1}`;
}

const EMPLOYEE_FIELD_LABELS: Record<string, string> = {
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
};

const EMPLOYEE_FIELD_ORDER = Object.keys(EMPLOYEE_FIELD_LABELS);

function fieldLabel(field: unknown): string {
  const key = String(field ?? "");
  return EMPLOYEE_FIELD_LABELS[key] ?? key.replaceAll("_", " ");
}

function changedFieldDetails(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): HistoryDetail[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(
    (a, b) => {
      const aIndex = EMPLOYEE_FIELD_ORDER.indexOf(a);
      const bIndex = EMPLOYEE_FIELD_ORDER.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    },
  );
  return compactDetails(
    keys.map((key) =>
      detail(fieldLabel(key), [], fieldChange(before[key], after[key])),
    ),
  );
}

function employeeUpdateDetails(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): HistoryDetail[] {
  const changed = changedFieldDetails(before, after);
  if (changed.length > 0) return changed;
  const labels = [...new Set([...Object.keys(before), ...Object.keys(after)])].map(
    fieldLabel,
  );
  if (labels.length > 0) {
    return [{ label: "", chips: [], tags: labels }];
  }
  return [];
}

export function historyBlock(entry: HistoryRow, rows: ChartRow[]): HistoryBlock {
  const before = (entry.before ?? {}) as Record<string, unknown>;
  const after = (entry.after ?? {}) as Record<string, unknown>;
  const kind =
    entry.op === "set_assistant"
      ? after.is_assistant
        ? "Assistant"
        : "Place in team"
      : entry.op === "set_leaf_grid_columns"
        ? `Columns ${String(after.leaf_grid_columns ?? "?")}`
        : (OP_KIND[entry.op] ?? entry.op.replaceAll("_", " "));
  const base: HistoryBlock = {
    id: entry.id,
    createdAt: entry.created_at,
    op: entry.op,
    kind,
    action: kind,
    actorName: entry.actor_name ?? null,
    focusNodeId: entry.node_id,
    subject: [],
    details: [],
  };

  switch (entry.op) {
    case "fork_sandbox":
      return {
        ...base,
        action: "Forked sandbox",
        subject: [
          {
            type: "team",
            name: `Live v${String(before.forked_from_seq ?? "?")}`,
            dept: null,
          },
        ],
        details: [
          {
            label: "From",
            chips: [
              {
                type: "team",
                name: `Live v${String(before.forked_from_seq ?? "?")}`,
                dept: null,
              },
            ],
          },
        ],
      };
    case "sync_from_live":
      return {
        ...base,
        action: "Synced from live",
        subject: [
          {
            type: "team",
            name: `Live v${String(after.target_seq ?? before.target_seq ?? "?")}`,
            dept: null,
          },
        ],
        details: [
          {
            label: "From",
            chips: [
              {
                type: "team",
                name: `Live v${String(before.forked_from_seq ?? "?")}`,
                dept: null,
              },
            ],
          },
        ],
      };
    case "move_node":
      return {
        ...base,
        action: "Moved",
        subject: [nodeChip(rows, entry.node_id, before)],
        details: compactDetails([
          detail("From", [nodeChip(rows, (before.parent_node_id as string) ?? null)]),
          detail("To", [nodeChip(rows, (after.parent_node_id as string) ?? null)]),
          before.is_assistant !== after.is_assistant
            ? detail(
                "Placement",
                [],
                fieldChange(
                  placementLabel(before.is_assistant),
                  placementLabel(after.is_assistant),
                ),
              )
            : null,
        ]),
      };
    case "assign_employee":
      return {
        ...base,
        action: "Added peer",
        subject: [
          personChip(
            rows,
            entry.employee_auth_id,
            entry.employee_name,
            entry.employee_avatar_url,
          ),
        ],
        details: compactDetails([
          detail("Seat", [nodeChip(rows, entry.node_id, before)]),
        ]),
      };
    case "unassign_employee":
      return {
        ...base,
        action: "Removed peer",
        subject: [
          personChip(
            rows,
            entry.employee_auth_id,
            entry.employee_name,
            entry.employee_avatar_url,
          ),
        ],
        details: compactDetails([
          detail("Seat", [nodeChip(rows, entry.node_id, before)]),
        ]),
      };
    case "set_peer_host":
      return {
        ...base,
        action: "Changed primary host",
        subject: [
          personChip(
            rows,
            entry.employee_auth_id,
            entry.employee_name,
            entry.employee_avatar_url,
          ),
        ],
        details: compactDetails([
          detail("Seat", [nodeChip(rows, entry.node_id, before)]),
        ]),
      };
    case "create_header": {
      const subject = nodeChip(rows, entry.node_id, after);
      const parent = nodeChip(rows, (after.parent_node_id as string) ?? null);
      return {
        ...base,
        action: "Created team",
        subject: [subject],
        details: compactDetails([detail("Under", [parent])]),
      };
    }
    case "create_seat":
      return {
        ...base,
        action: "Created position",
        subject: [nodeChip(rows, entry.node_id, after)],
        details: compactDetails([
          detail("Under", [nodeChip(rows, (after.parent_node_id as string) ?? null)]),
          detail("Title", [], textValue(after.job_title, "")),
          after.is_assistant ? detail("Placement", [], "Assistant") : null,
        ]),
      };
    case "rename_header": {
      const oldName = String(before.name ?? "");
      const newName = String(after.name ?? "");
      const oldChip = {
        type: "team" as const,
        name: oldName || nodeChip(rows, entry.node_id, before).name,
        dept: deptFor(rows, entry.node_id),
      };
      const newChip = {
        type: "team" as const,
        name: newName || nodeChip(rows, entry.node_id, after).name,
        dept: deptFor(rows, entry.node_id),
      };
      return {
        ...base,
        action: "Renamed team",
        subject: [newChip],
        details: compactDetails([
          detail("Name", [], fieldChange(oldChip.name, newChip.name)),
        ]),
      };
    }
    case "delete_seat":
    case "delete_header": {
      const reparented = Array.isArray(after.reparented) ? after.reparented.length : 0;
      const subject = nodeChip(rows, entry.node_id, before, {
        authId: entry.employee_auth_id,
        name: entry.employee_name,
        avatarUrl: entry.employee_avatar_url,
      });
      return {
        ...base,
        action: entry.op === "delete_header" ? "Removed team" : "Removed position",
        subject: [subject],
        details: compactDetails([
          detail("From", [nodeChip(rows, (before.parent_node_id as string) ?? null)]),
          reparented > 0
            ? detail(
                "Children",
                [],
                `${reparented} ${reparented === 1 ? "child" : "children"} moved up`,
              )
            : null,
        ]),
      };
    }
    case "reorder_node": {
      const beforePosition = ordinal(before.sort_order);
      const afterPosition = ordinal(after.sort_order);
      return {
        ...base,
        action: "Reordered",
        subject: [nodeChip(rows, entry.node_id, before)],
        details: compactDetails([
          detail("Within", [
            nodeChip(
              rows,
              ((after.parent_node_id ?? before.parent_node_id) as string) ?? null,
            ),
          ]),
          beforePosition && afterPosition && beforePosition !== afterPosition
            ? detail("Position", [], `${beforePosition} → ${afterPosition}`)
            : null,
        ]),
      };
    }
    case "set_assistant":
      return {
        ...base,
        action: after.is_assistant ? "Placed as assistant" : "Placed in team",
        subject: [nodeChip(rows, entry.node_id, before)],
        details: compactDetails([
          detail(
            "Placement",
            [],
            fieldChange(
              placementLabel(before.is_assistant),
              placementLabel(after.is_assistant),
            ),
          ),
        ]),
      };
    case "set_leaf_grid_columns":
      return {
        ...base,
        action: "Changed layout columns",
        subject: [nodeChip(rows, entry.node_id, before)],
        details: compactDetails([
          detail(
            "Columns",
            [],
            fieldChange(
              `${textValue(before.leaf_grid_columns, "?")} columns`,
              `${textValue(after.leaf_grid_columns, "?")} columns`,
            ),
          ),
        ]),
      };
    case "set_override":
      return {
        ...base,
        action: "Updated details for",
        subject: [
          personChip(
            rows,
            entry.employee_auth_id,
            entry.employee_name,
            entry.employee_avatar_url,
          ),
        ],
        details: compactDetails([
          detail(fieldLabel(after.field), [], fieldChange(before.value, after.value)),
        ]),
      };
    case "clear_override":
      return {
        ...base,
        action: "Cleared override for",
        subject: [
          personChip(
            rows,
            entry.employee_auth_id,
            entry.employee_name,
            entry.employee_avatar_url,
          ),
        ],
        details: compactDetails([
          detail(fieldLabel(after.field), [], fieldChange(before.value, after.value)),
        ]),
      };
    case "update_employee": {
      const subject = personChip(
        rows,
        entry.employee_auth_id,
        entry.employee_name ?? textValue(after.full_name || before.full_name, ""),
        entry.employee_avatar_url,
      );
      const details = employeeUpdateDetails(before, after);
      return {
        ...base,
        action: "Updated employee",
        subject: [subject],
        details,
      };
    }
    case "rename_seat":
      return {
        ...base,
        action: "Renamed position",
        subject: [nodeChip(rows, entry.node_id, after)],
        details: compactDetails([
          detail("Job title", [], fieldChange(before.job_title, after.job_title)),
        ]),
      };
    case "set_primary_seat":
      return {
        ...base,
        action: "Changed primary seat for",
        subject: [
          personChip(
            rows,
            entry.employee_auth_id,
            entry.employee_name,
            entry.employee_avatar_url,
          ),
        ],
        details: compactDetails([
          chipDiff(
            "Primary seat",
            [nodeChip(rows, (before.node_id as string) ?? null)],
            [nodeChip(rows, (after.node_id as string) ?? null)],
          ),
        ]),
      };
    default:
      return {
        ...base,
        action: base.kind,
        subject: [nodeChip(rows, entry.node_id, before)],
      };
  }
}

/** Newest-first log rows → one block per command. */
export function historyBlocks(entries: HistoryRow[], rows: ChartRow[]): HistoryBlock[] {
  const byCommand = new Map<string, HistoryRow[]>();
  for (const entry of entries) {
    if (!entry.command_id) continue;
    const list = byCommand.get(entry.command_id) ?? [];
    list.push(entry);
    byCommand.set(entry.command_id, list);
  }
  const groups: HistoryRow[][] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const commandId = entry.command_id;
    if (!commandId) {
      groups.push([entry]);
      continue;
    }
    if (seen.has(commandId)) continue;
    seen.add(commandId);
    groups.push(byCommand.get(commandId) ?? [entry]);
  }
  return groups.map((group) => {
    const head = group[0]!;
    const kind = head.command_kind;
    const source =
      (kind === "undo" || kind === "redo") && head.undoes_command_id
        ? (byCommand.get(head.undoes_command_id) ?? group)
        : group;
    const picked = (representativeLogRow(source) as HistoryRow | null) ?? source[0]!;
    const block = historyBlock(picked, rows);
    const id = head.command_id ?? head.id;
    const withCommandActor = {
      ...block,
      id,
      actorName: head.actor_name ?? block.actorName,
    };
    if (kind === "undo") return { ...withCommandActor, kind: "Undid" };
    if (kind === "redo") return { ...withCommandActor, kind: "Redid" };
    return withCommandActor;
  });
}

export function groupByDay(
  entries: HistoryBlock[],
): Array<{ day: string; items: HistoryBlock[] }> {
  const groups: Array<{ day: string; items: HistoryBlock[] }> = [];
  for (const item of entries) {
    const day = new Date(item.createdAt).toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}
