/**
 * Three-way state diff + apply. Do not replay change_log.
 *
 * Per entity, matched by node_id: sandbox-only → auto-apply; live-only → keep
 * live; both-same → auto-apply; both-different → conflict (four kinds).
 * sort_order always sandbox-wins. Multi-role assignments union, never conflict.
 */

import { byId, cloneNode, nodeLabel } from "./tree";
import {
  ALLOWED,
  type AutoChange,
  type Conflict,
  type ConflictSide,
  type EmployeeFieldChange,
  type MergeAssignment,
  type MergeCounts,
  type MergeInput,
  type MergeLog,
  type MergeNode,
  type MergeResult,
  type MergeSnapshot,
  type MergeTarget,
  type OverrideMap,
  type Resolution,
} from "./types";
import { validateGraph } from "./validate";

function keepOneAssistant(nodes: MergeNode[], sandbox: Map<string, MergeNode>): void {
  const grouped = new Map<string, MergeNode[]>();
  for (const node of nodes) {
    if (!node.isAssistant) continue;
    const list = grouped.get(node.parentId) ?? [];
    list.push(node);
    grouped.set(node.parentId, list);
  }
  for (const list of grouped.values()) {
    if (list.length <= 1) continue;
    const keep = list.find((n) => sandbox.get(n.id)?.isAssistant) ?? list[0]!;
    for (const node of list) {
      if (node.id !== keep.id) node.isAssistant = false;
    }
  }
}

function asMap(nodes: MergeNode[]): Map<string, MergeNode> {
  return byId(nodes);
}

function ids(...maps: Map<string, MergeNode>[]): Set<string> {
  const out = new Set<string>();
  for (const map of maps) for (const id of map.keys()) out.add(id);
  return out;
}

function parentUnusable(
  parentId: string,
  live: Map<string, MergeNode>,
  sandbox: Map<string, MergeNode>,
  base: Map<string, MergeNode>,
): boolean {
  if (parentId === "") return false;
  const parent = live.get(parentId);
  if (parent) {
    if (parent.kind !== "seat") return false;
    if (parent.assignments.length === 0) return false;
    return parent.assignments.every((a) => a.status === "resigned");
  }
  if (sandbox.has(parentId) && !base.has(parentId)) return false;
  return true;
}

function scalarChanged<T>(a: T, b: T): boolean {
  return a !== b;
}

function choice(
  key: string,
  resolutions: Record<string, Resolution> | undefined,
): Resolution | undefined {
  return resolutions?.[key];
}

function included(key: string, keys: string[] | null | undefined): boolean {
  return keys == null || keys.includes(key);
}

function empIndex(node: MergeNode | undefined): Map<string, MergeAssignment> {
  const map = new Map<string, MergeAssignment>();
  if (!node) return map;
  for (const a of node.assignments) map.set(a.employeeAuthId, a);
  return map;
}

const MISSING_SIDE: ConflictSide = { exists: false, parentLabel: null, title: null };

function sideOf(
  node: MergeNode | undefined,
  tree: Map<string, MergeNode>,
): ConflictSide {
  if (!node) return MISSING_SIDE;
  const parent = node.parentId ? tree.get(node.parentId) : undefined;
  return {
    exists: true,
    parentLabel: parent ? nodeLabel(parent) : null,
    title: node.kind === "header" ? node.name : node.jobTitle,
  };
}

function overrideKeys(...maps: (OverrideMap | undefined)[]): string[] {
  const keys = new Set<string>();
  for (const map of maps) {
    if (!map) continue;
    for (const k of Object.keys(map)) keys.add(k);
  }
  return [...keys];
}

function overrideChanged(
  a: OverrideMap | undefined,
  b: OverrideMap | undefined,
  id: string,
): boolean {
  return (
    JSON.stringify(overrideComparable(a?.[id])) !==
    JSON.stringify(overrideComparable(b?.[id]))
  );
}

function overrideComparable(
  row: OverrideMap[string] | undefined,
): Record<string, unknown> | null {
  if (!row) return null;
  return {
    displayName: row.displayName,
    displayTitle: row.displayTitle,
    avatarUrl: row.avatarUrl,
    legalFullName: row.legalFullName,
    officeCountry: row.officeCountry,
    officeLocation: row.officeLocation,
    hiringCompany: row.hiringCompany,
    status: row.status,
    joiningDate: row.joiningDate,
    hiredAt: row.hiredAt,
    resignationDate: row.resignationDate,
    lastWorkingDate: row.lastWorkingDate,
    employeeId: row.employeeId,
    employmentRecord: row.employmentRecord,
    positionLevel: row.positionLevel,
    primaryManagerAuthId: row.primaryManagerAuthId,
    primaryTeamPath: row.primaryTeamPath,
  };
}

function overrideLabel(row: OverrideMap[string] | undefined, fallback: string): string {
  return row?.displayName ?? fallback;
}

const EMPLOYEE_REVIEW_FIELDS: Array<{
  field: keyof OverrideMap[string];
  label: string;
}> = [
  { field: "displayName", label: "Full name" },
  { field: "avatarUrl", label: "Avatar URL" },
  { field: "status", label: "Status" },
  { field: "employeeId", label: "Employee ID" },
  { field: "employmentRecord", label: "Employment record" },
  { field: "displayTitle", label: "Person job title" },
  { field: "positionLevel", label: "Position level" },
  { field: "legalFullName", label: "Legal full name" },
  { field: "joiningDate", label: "Joining date" },
  { field: "hiredAt", label: "Hired date" },
  { field: "resignationDate", label: "Resignation date" },
  { field: "lastWorkingDate", label: "Last working date" },
  { field: "officeCountry", label: "Office country" },
  { field: "officeLocation", label: "Office location" },
  { field: "hiringCompany", label: "Hiring company" },
];

function reviewValue(value: unknown): string | null {
  return value == null ? null : String(value);
}

function employeeFieldChanges(
  before: OverrideMap[string] | undefined,
  after: OverrideMap[string] | undefined,
): EmployeeFieldChange[] {
  if (!after) return [];
  return EMPLOYEE_REVIEW_FIELDS.flatMap(({ field, label }) => {
    const beforeValue = reviewValue(before?.[field]);
    const afterValue = reviewValue(after[field]);
    return beforeValue === afterValue
      ? []
      : [{ field, label, before: beforeValue, after: afterValue }];
  });
}

export function runMerge(input: MergeInput): MergeResult {
  const target: MergeTarget = input.target ?? "published";
  const base = asMap(input.base);
  const live = asMap(input.live);
  const sandbox = asMap(input.sandbox);
  const zeroDrift = input.forkedFromSeq === input.liveSeq;
  const resolutions = input.resolutions ?? {};

  const conflicts: Conflict[] = [];
  const changes: AutoChange[] = [];

  detectConflicts(base, live, sandbox, input, conflicts);
  if (target === "published") {
    collectAutoChanges(base, live, sandbox, changes);
    collectOverrideChanges(
      input.baseOverrides,
      input.liveOverrides,
      input.sandboxOverrides,
      input.liveEmployeeDetails,
      changes,
      "sandbox",
    );
  } else {
    collectLiveChanges(base, live, sandbox, changes);
    collectOverrideChanges(
      input.baseOverrides,
      input.liveOverrides,
      input.sandboxOverrides,
      input.liveEmployeeDetails,
      changes,
      "live",
    );
  }

  const unresolved = conflicts.filter((c) => !isResolved(c, resolutions));
  const merged = applyMerge(base, live, sandbox, input, conflicts, target);
  applyOverrideAssignments(merged, input, conflicts, resolutions, target);
  keepOneAssistant(merged, sandbox);

  const graphConflicts = unresolved.length === 0 ? validateGraph(merged) : [];
  const valid = unresolved.length === 0 && graphConflicts.length === 0;

  const logs =
    valid && target === "published"
      ? logsFromBeforeToMerged(live, merged)
      : valid && target === "sandbox"
        ? logsFromBeforeToMerged(sandbox, merged)
        : [];
  const counts = countLogs(logs);
  counts.edits += countAppliedOverrideChanges(input, conflicts, resolutions, target);
  const versionSource = target === "published" ? live : sandbox;
  const effectiveOverrides = resolvedOverrides(input, conflicts, resolutions, target);
  const snapshot = buildSnapshot(
    target,
    input.liveSeq,
    versionSource,
    merged,
    logs,
    effectiveOverrides,
  );
  const tintBefore = target === "published" ? live : sandbox;
  const tints = computeTints(tintBefore, merged);
  for (const change of changes) {
    if (!change.key.startsWith("employee:") || tints.edited.includes(change.nodeId))
      continue;
    tints.edited.push(change.nodeId);
  }

  return {
    zeroDrift,
    drift: !zeroDrift,
    changes,
    conflicts,
    unresolved,
    graphConflicts,
    merged,
    valid,
    counts,
    snapshot,
    tints,
  };
}

function isResolved(
  conflict: Conflict,
  resolutions: Record<string, Resolution>,
): boolean {
  const r = resolutions[conflict.key];
  if (!r) return false;
  if (r.choice === "pick_new_target") return Boolean(r.newParentId);
  return conflict.allowed.includes(r.choice);
}

function detectConflicts(
  base: Map<string, MergeNode>,
  live: Map<string, MergeNode>,
  sandbox: Map<string, MergeNode>,
  input: MergeInput,
  conflicts: Conflict[],
): void {
  for (const id of ids(base, live, sandbox)) {
    const b = base.get(id);
    const l = live.get(id);
    const s = sandbox.get(id);

    const liveDeleted = Boolean(b && !l);
    const sandboxKeeps = Boolean(s);

    if (liveDeleted && sandboxKeeps) {
      const key = `stale_source:${id}:exists`;
      conflicts.push({
        key,
        kind: "stale_source",
        nodeId: id,
        field: "exists",
        label: nodeLabel(s),
        sentence: `${nodeLabel(s)} — choose Live chart or Sandbox.`,
        live: MISSING_SIDE,
        sandbox: sideOf(s, sandbox),
        allowed: ALLOWED.stale_source,
      });
      continue;
    }

    if (!s || !l) continue;

    const sandboxMoved = b ? scalarChanged(s.parentId, b.parentId) : false;
    const liveMoved = b ? scalarChanged(l.parentId, b.parentId) : false;

    if (sandboxMoved && parentUnusable(s.parentId, live, sandbox, base)) {
      const dest = sandbox.get(s.parentId) ?? base.get(s.parentId);
      conflicts.push({
        key: `stale_target:${id}:parent`,
        kind: "stale_target",
        nodeId: id,
        field: "parent",
        relatedId: s.parentId,
        label: nodeLabel(s),
        sentence: `${nodeLabel(s)} — the sandbox parent is gone on the live chart.`,
        live: sideOf(l, live),
        sandbox: {
          exists: true,
          parentLabel: dest ? nodeLabel(dest) : "a team that is gone",
          title: s.kind === "header" ? s.name : s.jobTitle,
        },
        allowed: ALLOWED.stale_target,
      });
    } else if (sandboxMoved && liveMoved && s.parentId !== l.parentId) {
      conflicts.push({
        key: `concurrent_move:${id}:parent`,
        kind: "concurrent_move",
        nodeId: id,
        field: "parent",
        label: nodeLabel(s),
        sentence: `${nodeLabel(s)} — Live chart and Sandbox disagree on the parent.`,
        live: sideOf(l, live),
        sandbox: sideOf(s, sandbox),
        allowed: ALLOWED.concurrent_move,
      });
    }

    if (
      s.kind === "header" &&
      b &&
      scalarChanged(s.name, b.name) &&
      scalarChanged(l.name, b.name) &&
      s.name !== l.name
    ) {
      conflicts.push({
        key: `concurrent_edit:${id}:name`,
        kind: "concurrent_edit",
        nodeId: id,
        field: "name",
        label: nodeLabel(b),
        sentence: `${nodeLabel(b)} — Live chart and Sandbox disagree on the name.`,
        live: sideOf(l, live),
        sandbox: sideOf(s, sandbox),
        allowed: ALLOWED.concurrent_edit,
      });
    }
    if (
      s.kind === "seat" &&
      b &&
      scalarChanged(s.jobTitle, b.jobTitle) &&
      scalarChanged(l.jobTitle, b.jobTitle) &&
      s.jobTitle !== l.jobTitle
    ) {
      conflicts.push({
        key: `concurrent_edit:${id}:job_title`,
        kind: "concurrent_edit",
        nodeId: id,
        field: "job_title",
        label: nodeLabel(s),
        sentence: `${nodeLabel(s)} — Live chart and Sandbox disagree on the title.`,
        live: sideOf(l, live),
        sandbox: sideOf(s, sandbox),
        allowed: ALLOWED.concurrent_edit,
      });
    }
  }

  for (const authId of overrideKeys(
    input.baseOverrides,
    input.liveOverrides,
    input.sandboxOverrides,
  )) {
    if (
      overrideChanged(input.sandboxOverrides, input.baseOverrides, authId) &&
      overrideChanged(input.liveOverrides, input.baseOverrides, authId) &&
      overrideChanged(input.sandboxOverrides, input.liveOverrides, authId)
    ) {
      conflicts.push({
        key: `concurrent_edit:${authId}:override`,
        kind: "concurrent_edit",
        nodeId: authId,
        field: "override",
        label: overrideLabel(input.sandboxOverrides?.[authId], "Employee details"),
        sentence: "Live chart and Sandbox disagree on this person's details.",
        live: {
          exists: true,
          parentLabel: null,
          title: input.liveOverrides?.[authId]?.displayName ?? null,
        },
        sandbox: {
          exists: true,
          parentLabel: null,
          title: input.sandboxOverrides?.[authId]?.displayName ?? null,
        },
        allowed: ALLOWED.concurrent_edit,
      });
    }
  }
}

function collectOverrideChanges(
  baseOverrides: OverrideMap | undefined,
  liveOverrides: OverrideMap | undefined,
  sandboxOverrides: OverrideMap | undefined,
  liveEmployeeDetails: OverrideMap | undefined,
  changes: AutoChange[],
  source: "sandbox" | "live",
): void {
  for (const authId of overrideKeys(baseOverrides, liveOverrides, sandboxOverrides)) {
    const changedInSource =
      source === "sandbox"
        ? overrideChanged(sandboxOverrides, baseOverrides, authId)
        : overrideChanged(liveOverrides, baseOverrides, authId);
    const changedInOther =
      source === "sandbox"
        ? overrideChanged(liveOverrides, baseOverrides, authId)
        : overrideChanged(sandboxOverrides, baseOverrides, authId);
    if (!changedInSource || changedInOther) continue;
    const row =
      source === "sandbox" ? sandboxOverrides?.[authId] : liveOverrides?.[authId];
    const fieldChanges = employeeFieldChanges(liveEmployeeDetails?.[authId], row);
    if (fieldChanges.length === 0) continue;
    changes.push({
      key: `employee:${authId}`,
      nodeId: row?.nodeId ?? authId,
      kind: "edit",
      summary: `Update ${overrideLabel(row, "employee details")}`,
      fieldChanges,
      employee: row
        ? {
            name: overrideLabel(row, "Employee"),
            avatarUrl: row.avatarUrl,
            actorName: row.updatedBy
              ? (liveEmployeeDetails?.[row.updatedBy]?.displayName ?? null)
              : null,
            updatedAt: row.updatedAt ?? null,
          }
        : undefined,
    });
  }
}

function collectAutoChanges(
  base: Map<string, MergeNode>,
  live: Map<string, MergeNode>,
  sandbox: Map<string, MergeNode>,
  changes: AutoChange[],
): void {
  for (const id of ids(base, live, sandbox)) {
    const b = base.get(id);
    const l = live.get(id);
    const s = sandbox.get(id);

    if (s && !b && !l) {
      changes.push({
        key: `create:${id}`,
        nodeId: id,
        kind: "create",
        summary: `Create ${nodeLabel(s)}`,
      });
    }
    if (b && !s && l) {
      changes.push({
        key: `delete:${id}`,
        nodeId: id,
        kind: "delete",
        summary: `Delete ${nodeLabel(l)}`,
      });
    }
    if (s && b && l && s.parentId !== b.parentId && l.parentId === b.parentId) {
      changes.push({
        key: `move:${id}`,
        nodeId: id,
        kind: "move",
        summary: `Move ${nodeLabel(s)}`,
      });
    }
    if (s && b && l && s.kind === "header" && s.name !== b.name && l.name === b.name) {
      changes.push({
        key: `edit:${id}:name`,
        nodeId: id,
        kind: "edit",
        summary: `Rename ${b.name} → ${s.name}`,
      });
    }
    if (
      s &&
      b &&
      l &&
      s.kind === "seat" &&
      s.jobTitle !== b.jobTitle &&
      l.jobTitle === b.jobTitle
    ) {
      changes.push({
        key: `edit:${id}:job_title`,
        nodeId: id,
        kind: "edit",
        summary: `Retitle ${nodeLabel(s)}`,
      });
    }
    if (s && b && s.sortOrder !== b.sortOrder) {
      changes.push({
        key: `reorder:${id}`,
        nodeId: id,
        kind: "reorder",
        summary: `Reorder ${nodeLabel(s)}`,
      });
    }
    if (s && b && s.leafGridColumns !== b.leafGridColumns) {
      changes.push({
        key: `columns:${id}`,
        nodeId: id,
        kind: "edit",
        summary: `Set columns on ${nodeLabel(s)} to ${s.leafGridColumns}`,
      });
    }

    const bEmp = empIndex(b);
    const lEmp = empIndex(l);
    const sEmp = empIndex(s);
    const empIds = new Set([...bEmp.keys(), ...lEmp.keys(), ...sEmp.keys()]);
    for (const empId of empIds) {
      const was = bEmp.has(empId);
      const sb = sEmp.has(empId);
      const lv = lEmp.has(empId);
      if (sb && !was && !lv) {
        changes.push({
          key: `assign:${id}:${empId}`,
          nodeId: id,
          kind: "assign",
          summary: `Assign ${sEmp.get(empId)?.displayName ?? "member"}`,
        });
      }
      if (was && !sb && lv) {
        changes.push({
          key: `unassign:${id}:${empId}`,
          nodeId: id,
          kind: "unassign",
          summary: `Unassign ${lEmp.get(empId)?.displayName ?? "member"}`,
        });
      }
      if (sb && lv && sEmp.get(empId)!.isHost !== lEmp.get(empId)!.isHost && was) {
        const sHost = sEmp.get(empId)!.isHost;
        const bHost = bEmp.get(empId)?.isHost;
        const lHost = lEmp.get(empId)!.isHost;
        if (sHost !== bHost && lHost === bHost) {
          changes.push({
            key: `host:${id}:${empId}`,
            nodeId: id,
            kind: "peer",
            summary: `Peer host on ${nodeLabel(s ?? l)}`,
          });
        }
      }
    }
  }
}

function collectLiveChanges(
  base: Map<string, MergeNode>,
  live: Map<string, MergeNode>,
  sandbox: Map<string, MergeNode>,
  changes: AutoChange[],
): void {
  for (const id of ids(base, live, sandbox)) {
    const b = base.get(id);
    const l = live.get(id);
    const s = sandbox.get(id);

    if (l && !b && !s) {
      changes.push({
        key: `create:${id}`,
        nodeId: id,
        kind: "create",
        summary: `Create ${nodeLabel(l)}`,
      });
    }
    if (b && !l && s) {
      changes.push({
        key: `delete:${id}`,
        nodeId: id,
        kind: "delete",
        summary: `Delete ${nodeLabel(l ?? b)}`,
      });
    }
    if (l && b && s && l.parentId !== b.parentId && s.parentId === b.parentId) {
      changes.push({
        key: `move:${id}`,
        nodeId: id,
        kind: "move",
        summary: `Move ${nodeLabel(l)}`,
      });
    }
    if (l && b && s && l.kind === "header" && l.name !== b.name && s.name === b.name) {
      changes.push({
        key: `edit:${id}:name`,
        nodeId: id,
        kind: "edit",
        summary: `Rename ${b.name} → ${l.name}`,
      });
    }
    if (
      l &&
      b &&
      s &&
      l.kind === "seat" &&
      l.jobTitle !== b.jobTitle &&
      s.jobTitle === b.jobTitle
    ) {
      changes.push({
        key: `edit:${id}:job_title`,
        nodeId: id,
        kind: "edit",
        summary: `Retitle ${nodeLabel(l)}`,
      });
    }
    if (l && b && l.sortOrder !== b.sortOrder && (!s || s.sortOrder === b.sortOrder)) {
      changes.push({
        key: `reorder:${id}`,
        nodeId: id,
        kind: "reorder",
        summary: `Reorder ${nodeLabel(l)}`,
      });
    }
    if (
      l &&
      b &&
      l.leafGridColumns !== b.leafGridColumns &&
      (!s || s.leafGridColumns === b.leafGridColumns)
    ) {
      changes.push({
        key: `columns:${id}`,
        nodeId: id,
        kind: "edit",
        summary: `Set columns on ${nodeLabel(l)} to ${l.leafGridColumns}`,
      });
    }

    const bEmp = empIndex(b);
    const lEmp = empIndex(l);
    const sEmp = empIndex(s);
    const empIds = new Set([...bEmp.keys(), ...lEmp.keys(), ...sEmp.keys()]);
    for (const empId of empIds) {
      const was = bEmp.has(empId);
      const sb = sEmp.has(empId);
      const lv = lEmp.has(empId);
      if (lv && !was && !sb) {
        changes.push({
          key: `assign:${id}:${empId}`,
          nodeId: id,
          kind: "assign",
          summary: `Assign ${lEmp.get(empId)?.displayName ?? "member"}`,
        });
      }
      if (was && !lv && sb) {
        changes.push({
          key: `unassign:${id}:${empId}`,
          nodeId: id,
          kind: "unassign",
          summary: `Unassign ${bEmp.get(empId)?.displayName ?? "member"}`,
        });
      }
      if (sb && lv && sEmp.get(empId)!.isHost !== lEmp.get(empId)!.isHost && was) {
        const lHost = lEmp.get(empId)!.isHost;
        const bHost = bEmp.get(empId)?.isHost;
        const sHost = sEmp.get(empId)!.isHost;
        if (lHost !== bHost && sHost === bHost) {
          changes.push({
            key: `host:${id}:${empId}`,
            nodeId: id,
            kind: "peer",
            summary: `Peer host on ${nodeLabel(l ?? s)}`,
          });
        }
      }
    }
  }
}

function applyMerge(
  base: Map<string, MergeNode>,
  live: Map<string, MergeNode>,
  sandbox: Map<string, MergeNode>,
  input: MergeInput,
  conflicts: Conflict[],
  target: MergeTarget,
): MergeNode[] {
  const toPublished = target === "published";
  const keys = input.includedKeys;
  const res = input.resolutions ?? {};
  const out = new Map<string, MergeNode>();

  for (const id of ids(base, live, sandbox)) {
    const b = base.get(id);
    const l = live.get(id);
    const s = sandbox.get(id);

    const stale = conflicts.find((c) => c.nodeId === id && c.kind === "stale_source");
    if (stale) {
      const r = choice(stale.key, res);
      if (r?.choice === "recreate" && s) {
        out.set(id, cloneNode(s));
      }
      continue;
    }

    if (s && !b && !l) {
      if (!toPublished || included(`create:${id}`, keys)) out.set(id, cloneNode(s));
      continue;
    }
    if (b && !s && l) {
      if (toPublished && !included(`delete:${id}`, keys)) out.set(id, cloneNode(l));
      continue;
    }
    if (l && !s && !b) {
      out.set(id, cloneNode(l));
      continue;
    }
    if (s && l) {
      const node = cloneNode(toPublished ? l : s);
      applyFields(node, b, l, s, id, keys, res, conflicts, target);
      out.set(id, node);
    }
  }

  applyComboDrops(out, toPublished ? live : sandbox, input.resolutions ?? {});

  return [...out.values()];
}

function applyComboDrops(
  out: Map<string, MergeNode>,
  live: Map<string, MergeNode>,
  resolutions: Record<string, Resolution>,
): void {
  for (const [key, resolution] of Object.entries(resolutions)) {
    if (resolution.choice !== "drop" || !key.startsWith("combo_")) continue;
    const nodeId = key.split(":").pop();
    if (!nodeId) continue;
    const node = out.get(nodeId);
    const liveNode = live.get(nodeId);
    if (node && liveNode) node.parentId = liveNode.parentId;
  }
}

function chosenOverride(
  authId: string,
  input: MergeInput,
  conflicts: Conflict[],
  resolutions: Record<string, Resolution>,
  target: MergeTarget,
): OverrideMap[string] | undefined {
  const conflict = conflicts.find((c) => c.field === "override" && c.nodeId === authId);
  if (conflict) {
    const resolution = choice(conflict.key, resolutions);
    if (resolution?.choice === "use_sandbox") return input.sandboxOverrides?.[authId];
    if (resolution?.choice === "use_live") return input.liveOverrides?.[authId];
    if (resolution?.choice === "drop")
      return target === "published"
        ? input.liveOverrides?.[authId]
        : input.sandboxOverrides?.[authId];
    return input.sandboxOverrides?.[authId];
  }

  if (target === "published") {
    if (overrideChanged(input.sandboxOverrides, input.baseOverrides, authId)) {
      if (!included(`employee:${authId}`, input.includedKeys)) {
        return input.liveOverrides?.[authId];
      }
      return input.sandboxOverrides?.[authId];
    }
    return input.liveOverrides?.[authId];
  }

  if (overrideChanged(input.liveOverrides, input.baseOverrides, authId)) {
    return input.liveOverrides?.[authId];
  }
  return input.sandboxOverrides?.[authId];
}

function resolvedOverrides(
  input: MergeInput,
  conflicts: Conflict[],
  resolutions: Record<string, Resolution>,
  target: MergeTarget,
): OverrideMap {
  const result: OverrideMap = {};
  for (const authId of overrideKeys(
    input.baseOverrides,
    input.liveOverrides,
    input.sandboxOverrides,
  )) {
    const row = chosenOverride(authId, input, conflicts, resolutions, target);
    if (row) result[authId] = row;
  }
  return result;
}

function applyOverrideAssignments(
  merged: MergeNode[],
  input: MergeInput,
  conflicts: Conflict[],
  resolutions: Record<string, Resolution>,
  target: MergeTarget,
): void {
  for (const authId of overrideKeys(
    input.baseOverrides,
    input.liveOverrides,
    input.sandboxOverrides,
  )) {
    const row = chosenOverride(authId, input, conflicts, resolutions, target);
    if (!row) continue;
    for (const node of merged) {
      for (const assignment of node.assignments) {
        if (assignment.employeeAuthId !== authId) continue;
        assignment.displayName = row.displayName ?? "Unknown";
        assignment.displayTitle = row.displayTitle ?? "";
        assignment.avatarUrl = row.avatarUrl;
        assignment.officeLocation = row.officeLocation ?? "";
        assignment.status = row.status ?? null;
        assignment.joiningDate = row.joiningDate ?? null;
      }
    }
  }
}

function countAppliedOverrideChanges(
  input: MergeInput,
  conflicts: Conflict[],
  resolutions: Record<string, Resolution>,
  target: MergeTarget,
): number {
  let count = 0;
  for (const authId of overrideKeys(
    input.baseOverrides,
    input.liveOverrides,
    input.sandboxOverrides,
  )) {
    const sandboxHasEffectiveChange =
      employeeFieldChanges(
        input.liveEmployeeDetails?.[authId],
        input.sandboxOverrides?.[authId],
      ).length > 0;
    const liveHasEffectiveChange =
      employeeFieldChanges(
        input.liveEmployeeDetails?.[authId],
        input.liveOverrides?.[authId],
      ).length > 0;
    const conflict = conflicts.find(
      (c) => c.field === "override" && c.nodeId === authId,
    );
    if (conflict) {
      const resolution = choice(conflict.key, resolutions);
      if (
        target === "published" &&
        resolution?.choice === "use_sandbox" &&
        sandboxHasEffectiveChange
      ) {
        count += 1;
      }
      if (
        target === "sandbox" &&
        resolution?.choice === "use_live" &&
        liveHasEffectiveChange
      ) {
        count += 1;
      }
      continue;
    }
    if (
      target === "published" &&
      overrideChanged(input.sandboxOverrides, input.baseOverrides, authId) &&
      included(`employee:${authId}`, input.includedKeys) &&
      sandboxHasEffectiveChange
    ) {
      count += 1;
    }
    if (
      target === "sandbox" &&
      overrideChanged(input.liveOverrides, input.baseOverrides, authId) &&
      liveHasEffectiveChange
    ) {
      count += 1;
    }
  }
  return count;
}

function applyFields(
  node: MergeNode,
  b: MergeNode | undefined,
  l: MergeNode,
  s: MergeNode,
  id: string,
  keys: string[] | null | undefined,
  res: Record<string, Resolution>,
  conflicts: Conflict[],
  target: MergeTarget,
): void {
  const toPublished = target === "published";
  const moveConflict = conflicts.find(
    (c) =>
      c.nodeId === id && (c.kind === "concurrent_move" || c.kind === "stale_target"),
  );
  if (moveConflict) {
    const r = choice(moveConflict.key, res);
    if (r?.choice === "use_live") node.parentId = l.parentId;
    else if (r?.choice === "pick_new_target") node.parentId = r.newParentId;
    else if (r?.choice === "use_sandbox") node.parentId = s.parentId;
    else if (r?.choice === "drop")
      node.parentId = toPublished ? l.parentId : s.parentId;
    else node.parentId = s.parentId;
  } else if (toPublished) {
    if (
      b &&
      s.parentId !== b.parentId &&
      l.parentId === b.parentId &&
      included(`move:${id}`, keys)
    ) {
      node.parentId = s.parentId;
    } else {
      node.parentId = l.parentId;
    }
  } else if (b && l.parentId !== b.parentId && s.parentId === b.parentId) {
    node.parentId = l.parentId;
  } else {
    node.parentId = s.parentId;
  }

  const nameConflict = conflicts.find((c) => c.nodeId === id && c.field === "name");
  if (nameConflict) {
    const r = choice(nameConflict.key, res);
    if (r?.choice === "use_live") node.name = l.name;
    else if (r?.choice === "use_sandbox") node.name = s.name;
    else if (r?.choice === "drop") node.name = toPublished ? l.name : s.name;
    else node.name = s.name;
  } else if (
    toPublished &&
    b &&
    s.name !== b.name &&
    l.name === b.name &&
    included(`edit:${id}:name`, keys)
  ) {
    node.name = s.name;
  } else if (!toPublished && b && l.name !== b.name && s.name === b.name) {
    node.name = l.name;
  }

  const titleConflict = conflicts.find(
    (c) => c.nodeId === id && c.field === "job_title",
  );
  if (titleConflict) {
    const r = choice(titleConflict.key, res);
    if (r?.choice === "use_live") node.jobTitle = l.jobTitle;
    else if (r?.choice === "use_sandbox") node.jobTitle = s.jobTitle;
    else if (r?.choice === "drop")
      node.jobTitle = toPublished ? l.jobTitle : s.jobTitle;
    else node.jobTitle = s.jobTitle;
  } else if (
    toPublished &&
    b &&
    s.jobTitle !== b.jobTitle &&
    l.jobTitle === b.jobTitle &&
    included(`edit:${id}:job_title`, keys)
  ) {
    node.jobTitle = s.jobTitle;
  } else if (
    !toPublished &&
    b &&
    l.jobTitle !== b.jobTitle &&
    s.jobTitle === b.jobTitle
  ) {
    node.jobTitle = l.jobTitle;
  }

  if (
    s &&
    (!b || s.sortOrder !== b.sortOrder) &&
    (toPublished ? included(`reorder:${id}`, keys) : true)
  ) {
    node.sortOrder = s.sortOrder;
  }

  node.isAssistant = Boolean(s.isAssistant);

  if (s && b && s.leafGridColumns !== b.leafGridColumns) {
    node.leafGridColumns = s.leafGridColumns;
  } else if (!toPublished && l && b && l.leafGridColumns !== b.leafGridColumns) {
    node.leafGridColumns = l.leafGridColumns;
  } else {
    node.leafGridColumns = l.leafGridColumns;
  }

  node.kind = s.kind;
  node.positionLevel = s.positionLevel ?? l.positionLevel;
  node.assignments = mergeAssignments(b, l, s, id, keys, target);
}

function mergeAssignments(
  b: MergeNode | undefined,
  l: MergeNode,
  s: MergeNode,
  id: string,
  keys: string[] | null | undefined,
  target: MergeTarget,
): MergeAssignment[] {
  const toPublished = target === "published";
  const bEmp = empIndex(b);
  const lEmp = empIndex(l);
  const sEmp = empIndex(s);
  const empIds = new Set([...bEmp.keys(), ...lEmp.keys(), ...sEmp.keys()]);
  const out: MergeAssignment[] = [];

  for (const empId of empIds) {
    const was = bEmp.has(empId);
    const sb = sEmp.has(empId);
    const lv = lEmp.has(empId);

    let keep = Boolean(lv || sb);
    if (toPublished) {
      if (was && !sb && included(`unassign:${id}:${empId}`, keys)) keep = false;
      if (!was && sb && !included(`assign:${id}:${empId}`, keys)) keep = lv;
    } else {
      if (was && !lv && sb) keep = true;
      if (!was && lv && !sb) keep = true;
    }

    if (!keep) continue;
    const src = (lv ? lEmp.get(empId) : sEmp.get(empId))!;
    const assignment = { ...src };
    if (
      sb &&
      lv &&
      sEmp.get(empId)!.isHost !== lEmp.get(empId)!.isHost &&
      was &&
      toPublished &&
      sEmp.get(empId)!.isHost !== (bEmp.get(empId)?.isHost ?? false) &&
      lEmp.get(empId)!.isHost === (bEmp.get(empId)?.isHost ?? false) &&
      included(`host:${id}:${empId}`, keys)
    ) {
      assignment.isHost = sEmp.get(empId)!.isHost;
    } else if (
      sb &&
      lv &&
      sEmp.get(empId)!.isHost !== lEmp.get(empId)!.isHost &&
      was &&
      !toPublished &&
      lEmp.get(empId)!.isHost !== (bEmp.get(empId)?.isHost ?? false) &&
      sEmp.get(empId)!.isHost === (bEmp.get(empId)?.isHost ?? false)
    ) {
      assignment.isHost = lEmp.get(empId)!.isHost;
    }
    out.push(assignment);
  }

  if (out.length > 0 && !out.some((a) => a.isHost)) {
    out[0]!.isHost = true;
  }
  out.sort((a, b) => Number(b.isHost) - Number(a.isHost));
  return out;
}

function logsFromBeforeToMerged(
  before: Map<string, MergeNode>,
  merged: MergeNode[],
): MergeLog[] {
  const next = asMap(merged);
  const logs: MergeLog[] = [];
  for (const id of ids(before, next)) {
    const l = before.get(id);
    const m = next.get(id);
    if (m && !l) {
      logs.push({
        op: m.kind === "header" ? "create_header" : "create_seat",
        nodeId: id,
        employeeAuthId: m.assignments[0]?.employeeAuthId ?? null,
        before: null,
        after: {
          parent_node_id: m.parentId || null,
          name: m.name,
          job_title: m.jobTitle,
          sort_order: m.sortOrder,
        },
      });
      continue;
    }
    if (l && !m) {
      logs.push({
        op: l.kind === "header" ? "delete_header" : "delete_seat",
        nodeId: id,
        employeeAuthId: null,
        before: {
          parent_node_id: l.parentId || null,
          name: l.name,
          job_title: l.jobTitle,
        },
        after: { reparented: [] },
      });
      continue;
    }
    if (!l || !m) continue;
    if (l.parentId !== m.parentId) {
      logs.push({
        op: "move_node",
        nodeId: id,
        employeeAuthId: null,
        before: { parent_node_id: l.parentId || null, sort_order: l.sortOrder },
        after: { parent_node_id: m.parentId || null, sort_order: m.sortOrder },
      });
    } else if (l.sortOrder !== m.sortOrder) {
      logs.push({
        op: "reorder_node",
        nodeId: id,
        employeeAuthId: null,
        before: { sort_order: l.sortOrder },
        after: { sort_order: m.sortOrder },
      });
    }
    if (l.kind === "header" && l.name !== m.name) {
      logs.push({
        op: "rename_header",
        nodeId: id,
        employeeAuthId: null,
        before: { name: l.name },
        after: { name: m.name },
      });
    }
    if (l.leafGridColumns !== m.leafGridColumns) {
      logs.push({
        op: "set_leaf_grid_columns",
        nodeId: id,
        employeeAuthId: null,
        before: { leaf_grid_columns: l.leafGridColumns },
        after: { leaf_grid_columns: m.leafGridColumns },
      });
    }
    const lEmp = empIndex(l);
    const mEmp = empIndex(m);
    const empIds = new Set([...lEmp.keys(), ...mEmp.keys()]);
    for (const empId of empIds) {
      const before = lEmp.get(empId);
      const after = mEmp.get(empId);
      if (after && !before) {
        logs.push({
          op: "assign_employee",
          nodeId: id,
          employeeAuthId: empId,
          before: null,
          after: { is_host: after.isHost },
        });
      } else if (before && !after) {
        logs.push({
          op: "unassign_employee",
          nodeId: id,
          employeeAuthId: empId,
          before: { is_host: before.isHost },
          after: null,
        });
      } else if (before && after && before.isHost !== after.isHost && after.isHost) {
        logs.push({
          op: "set_peer_host",
          nodeId: id,
          employeeAuthId: empId,
          before: {
            previous_host:
              [...lEmp.values()].find((a) => a.isHost)?.employeeAuthId ?? null,
          },
          after: { is_host: true },
        });
      }
    }
  }
  return logs;
}

function countLogs(logs: MergeLog[]): MergeCounts {
  const counts: MergeCounts = { moves: 0, edits: 0, creates: 0, deletes: 0, peers: 0 };
  for (const log of logs) {
    if (log.op === "move_node") counts.moves += 1;
    else if (log.op === "rename_header" || log.op === "reorder_node") counts.edits += 1;
    else if (log.op === "create_header" || log.op === "create_seat")
      counts.creates += 1;
    else if (log.op === "delete_header" || log.op === "delete_seat")
      counts.deletes += 1;
    else if (
      log.op === "assign_employee" ||
      log.op === "unassign_employee" ||
      log.op === "set_peer_host"
    ) {
      counts.peers += 1;
    }
  }
  return counts;
}

function parentsFirst(nodes: MergeNode[]): MergeNode[] {
  const by = asMap(nodes);
  const ordered: MergeNode[] = [];
  const seen = new Set<string>();
  const visit = (node: MergeNode) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    const parent = node.parentId ? by.get(node.parentId) : undefined;
    if (parent) visit(parent);
    ordered.push(node);
  };
  for (const node of nodes) visit(node);
  return ordered;
}

function buildSnapshot(
  direction: MergeTarget,
  liveSeq: number,
  versionSource: Map<string, MergeNode>,
  merged: MergeNode[],
  logs: MergeLog[],
  overrides: OverrideMap,
): MergeSnapshot {
  const expectedNodeVersions: Record<string, number> = {};
  for (const [id, node] of versionSource) expectedNodeVersions[id] = node.rowVersion;
  const ordered = parentsFirst(merged);
  return {
    direction,
    expectedLiveSeq: liveSeq,
    expectedNodeVersions,
    nodes: ordered.map((n) => ({
      node_id: n.id,
      parent_node_id: n.parentId === "" ? null : n.parentId,
      node_type: n.kind,
      sort_order: n.sortOrder,
      name: n.name,
      job_title: n.jobTitle,
      position_level: n.positionLevel,
      is_assistant: Boolean(n.isAssistant),
      leaf_grid_columns: n.leafGridColumns,
    })),
    assignments: ordered.flatMap((n) =>
      n.assignments.map((a) => ({
        node_id: n.id,
        employee_auth_id: a.employeeAuthId,
        is_host: a.isHost,
        is_primary: Boolean(a.isPrimary),
      })),
    ),
    employeeOverrides: Object.entries(overrides).map(([authId, row]) => ({
      auth_id: authId,
      node_id: row.nodeId ?? null,
      display_name: row.displayName,
      display_title: row.displayTitle,
      avatar_url: row.avatarUrl,
      legal_full_name: row.legalFullName ?? null,
      office_country: row.officeCountry ?? null,
      office_location: row.officeLocation ?? null,
      hiring_company: row.hiringCompany ?? null,
      status: row.status ?? null,
      joining_date: row.joiningDate ?? null,
      hired_at: row.hiredAt ?? null,
      resignation_date: row.resignationDate ?? null,
      last_working_date: row.lastWorkingDate ?? null,
      external_id: row.employeeId ?? null,
      employment_record: row.employmentRecord ?? null,
      position_level: row.positionLevel ?? null,
      primary_manager_auth_id: row.primaryManagerAuthId ?? null,
      primary_team_path: row.primaryTeamPath ?? null,
    })),
    logs,
  };
}

function assignmentSignature(node: MergeNode): string {
  return node.assignments
    .map((a) => `${a.employeeAuthId}:${a.isHost ? "h" : "p"}`)
    .sort()
    .join("|");
}

function nodeEdited(l: MergeNode, m: MergeNode): boolean {
  if (l.parentId !== m.parentId) return false;
  if (l.kind === "header" && l.name !== m.name) return true;
  if (l.kind === "seat" && l.jobTitle !== m.jobTitle) return true;
  return assignmentSignature(l) !== assignmentSignature(m);
}

function computeTints(
  live: Map<string, MergeNode>,
  merged: MergeNode[],
): MergeResult["tints"] {
  const next = asMap(merged);
  const added: string[] = [];
  const removed: string[] = [];
  const moved: string[] = [];
  const edited: string[] = [];
  for (const id of ids(live, next)) {
    const l = live.get(id);
    const m = next.get(id);
    if (m && !l) added.push(id);
    else if (l && !m) removed.push(id);
    else if (l && m && l.parentId !== m.parentId) moved.push(id);
    else if (l && m && nodeEdited(l, m)) edited.push(id);
  }
  return { added, removed, moved, edited };
}
