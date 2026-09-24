/**
 * Pure builder: published nodes → nested header-only JSON tree.
 * Seat parents are skipped: each header nests under its nearest ancestor header.
 * When the chart root is a seat (Publisher), top-level headers wrap under a synthetic root
 * named from the published version (e.g. `v12`).
 * Public payload: `{ name, level, children }` — no node ids.
 */

export type StructureNodeRow = {
  node_id: string;
  parent_node_id: string | null;
  node_type: "header" | "seat";
  name: string | null;
  sort_order: number;
};

/** Depth 0 = root, 1 = department, 2+ = team_level_1… */
export type HeaderLevel = "root" | "department" | `team_level_${number}`;

export type HeaderNode = {
  name: string;
  level: HeaderLevel;
  children: HeaderNode[];
};

export type BuildHeaderTreeOptions = {
  /** Published `version_seq`; used as the seat-root wrapper name (`v{n}`). */
  versionSeq: number;
};

export function headerLevelAtDepth(depth: number): HeaderLevel {
  if (depth < 0) {
    throw new Error(`Invalid header depth: ${depth}`);
  }
  if (depth === 0) return "root";
  if (depth === 1) return "department";
  return `team_level_${depth - 1}`;
}

export function publishedVersionLabel(versionSeq: number): string {
  return `v${versionSeq}`;
}

function nearestHeaderParent(
  nodeId: string,
  byId: Map<string, StructureNodeRow>,
): string | null {
  let current = byId.get(nodeId)?.parent_node_id ?? null;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) return null;
    seen.add(current);
    const node = byId.get(current);
    if (!node) return null;
    if (node.node_type === "header") return current;
    current = node.parent_node_id;
  }
  return null;
}

export function buildHeaderTree(
  rows: readonly StructureNodeRow[],
  options: BuildHeaderTreeOptions,
): HeaderNode {
  const byId = new Map<string, StructureNodeRow>();
  for (const row of rows) {
    byId.set(row.node_id, row);
  }

  const treeRoot = rows.find((row) => row.parent_node_id === null);
  if (!treeRoot) {
    throw new Error("Published tree has no root");
  }

  const headers = rows.filter((row) => row.node_type === "header");
  if (headers.length === 0) {
    throw new Error("Published tree has no headers");
  }

  const childrenByParent = new Map<string | null, StructureNodeRow[]>();
  for (const row of headers) {
    const parentKey = nearestHeaderParent(row.node_id, byId);
    const list = childrenByParent.get(parentKey) ?? [];
    list.push(row);
    childrenByParent.set(parentKey, list);
  }

  for (const list of childrenByParent.values()) {
    list.sort(
      (a, b) => a.sort_order - b.sort_order || a.node_id.localeCompare(b.node_id),
    );
  }

  function nest(row: StructureNodeRow, depth: number): HeaderNode {
    const kids = childrenByParent.get(row.node_id) ?? [];
    return {
      name: row.name ?? "",
      level: headerLevelAtDepth(depth),
      children: kids.map((kid) => nest(kid, depth + 1)),
    };
  }

  const topLevel = childrenByParent.get(null) ?? [];

  // Header is the chart root (unusual locally; still supported).
  if (treeRoot.node_type === "header") {
    if (topLevel.length !== 1 || topLevel[0]!.node_id !== treeRoot.node_id) {
      throw new Error(`Expected exactly one header root, found ${topLevel.length}`);
    }
    return nest(treeRoot, 0);
  }

  // Normal published shape: Publisher seat is the sole tree root; departments hang
  // under seats. Wrap those top-level headers so the JSON still has a single
  // `tree` object. Root name is the published version label.
  if (topLevel.length === 0) {
    throw new Error("Published tree has no headers under the root");
  }

  return {
    name: publishedVersionLabel(options.versionSeq),
    level: "root",
    children: topLevel.map((row) => nest(row, 1)),
  };
}
