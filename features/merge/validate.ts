/**
 * Pre-write graph checks. Never repair —
 * return second-round conflicts so the UI can pick one of the colliding moves.
 */

import { nodeLabel } from "./tree";
import { MAX_DEPTH, type Conflict, type ConflictSide, type MergeNode } from "./types";

const MISSING: ConflictSide = { exists: false, parentLabel: null, title: null };

function graphSide(node: MergeNode | undefined): ConflictSide {
  if (!node) return MISSING;
  return {
    exists: true,
    parentLabel: null,
    title: node.kind === "header" ? node.name : node.jobTitle,
  };
}

export function validateGraph(nodes: MergeNode[]): Conflict[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots = nodes.filter((n) => n.parentId === "");
  const conflicts: Conflict[] = [];

  if (roots.length !== 1) {
    const extra = [...roots].sort((a, b) => a.id.localeCompare(b.id));
    conflicts.push({
      key: `combo_root:${extra.map((r) => r.id).join(":")}`,
      kind: "combo_root",
      nodeId: extra[0]?.id ?? "",
      field: "parent",
      relatedId: extra[1]?.id,
      label: extra[0] ? nodeLabel(extra[0]) : "Tree",
      sentence:
        extra.length >= 2
          ? `Including or excluding these together would leave two roots (${nodeLabel(extra[0])} and ${nodeLabel(extra[1])}). Include or exclude related changes so there is one root.`
          : "Including or excluding these together would leave the tree with no root. Include the root change.",
      live: graphSide(extra[0]),
      sandbox: graphSide(extra[1] ?? extra[0]),
      allowed: ["drop"],
    });
    return conflicts;
  }

  const rootId = roots[0]!.id;
  const depth = new Map<string, number>([[rootId, 1]]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depth.get(id)!;
    for (const child of nodes) {
      if (child.parentId !== id) continue;
      if (depth.has(child.id)) continue;
      depth.set(child.id, d + 1);
      queue.push(child.id);
    }
  }

  const unreached = nodes.filter((n) => !depth.has(n.id));
  if (unreached.length > 0) {
    const cycle = cycleAmong(unreached, byId);
    if (cycle) {
      const [a, b] = cycle;
      const pair = [a, b].sort().join(":");
      for (const id of [a, b]) {
        const other = id === a ? b : a;
        conflicts.push({
          key: `combo_cycle:${pair}:${id}`,
          kind: "combo_cycle",
          nodeId: id,
          field: "parent",
          relatedId: other,
          label: nodeLabel(byId.get(id)),
          sentence: `Including or excluding these together would create a loop (${nodeLabel(byId.get(a))} ↔ ${nodeLabel(byId.get(b))}). Include the parent change or exclude the child.`,
          live: graphSide(byId.get(a)),
          sandbox: graphSide(byId.get(b)),
          allowed: ["drop"],
        });
      }
    } else {
      const node = unreached[0]!;
      const parent = byId.get(node.parentId);
      conflicts.push({
        key: `combo_orphan:${node.id}`,
        kind: "combo_orphan",
        nodeId: node.id,
        field: "parent",
        relatedId: node.parentId || undefined,
        label: nodeLabel(node),
        sentence: `Including or excluding these together would leave ${nodeLabel(node)} without a parent${parent ? ` (under ${nodeLabel(parent)})` : ""}. Include the parent change or exclude this one.`,
        live: parent ? graphSide(parent) : MISSING,
        sandbox: graphSide(node),
        allowed: ["drop"],
      });
    }
  }

  for (const [id, d] of depth) {
    if (d > MAX_DEPTH) {
      const node = byId.get(id)!;
      conflicts.push({
        key: `combo_depth:${id}`,
        kind: "combo_depth",
        nodeId: id,
        field: "parent",
        label: nodeLabel(node),
        sentence: `Including or excluding these together would push ${nodeLabel(node)} past depth ${MAX_DEPTH}. Include or exclude related moves.`,
        live: graphSide(node),
        sandbox: graphSide(node),
        allowed: ["drop"],
      });
      break;
    }
  }

  return conflicts;
}

function cycleAmong(
  unreached: MergeNode[],
  byId: Map<string, MergeNode>,
): [string, string] | null {
  const ids = new Set(unreached.map((n) => n.id));
  for (const start of unreached) {
    const seen = new Set<string>();
    let cur: MergeNode | undefined = start;
    while (cur && ids.has(cur.id)) {
      if (seen.has(cur.id)) {
        const next = byId.get(cur.parentId);
        return [cur.id, next?.id ?? cur.id];
      }
      seen.add(cur.id);
      cur = byId.get(cur.parentId);
    }
  }
  return null;
}
