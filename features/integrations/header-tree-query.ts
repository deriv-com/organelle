/**
 * Published-tree structure rows for header export — no employee joins.
 */

import { withDbRetry } from "@/lib/db";
import { fetchPublishedTreeMetadata } from "@/features/chart/tree-query";
import { buildHeaderTree, type HeaderNode, type StructureNodeRow } from "./header-tree";

export async function fetchPublishedStructureRows(): Promise<{
  treeId: string;
  versionSeq: number;
  rows: StructureNodeRow[];
}> {
  const meta = await fetchPublishedTreeMetadata();
  const rows = await withDbRetry(async (sql) => {
    return sql<StructureNodeRow[]>`
      select
        n.node_id,
        n.parent_node_id,
        n.node_type,
        n.name,
        n.sort_order
      from organelle.nodes n
      where n.tree_id = ${meta.treeId}
      order by n.sort_order, n.node_id
    `;
  });
  return { treeId: meta.treeId, versionSeq: meta.versionSeq, rows };
}

export async function fetchPublishedHeaderTree(): Promise<{
  treeId: string;
  versionSeq: number;
  tree: HeaderNode;
}> {
  const { treeId, versionSeq, rows } = await fetchPublishedStructureRows();
  return {
    treeId,
    versionSeq,
    tree: buildHeaderTree(rows, { versionSeq }),
  };
}
