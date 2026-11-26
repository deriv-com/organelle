import type { TransactionSql } from "postgres";

/** Called while holding the sandbox lock, before replacing its entire snapshot. */
export async function assertSandboxSnapshotUnchanged(
  tx: TransactionSql,
  treeId: string,
  expectedNodes: Record<string, number>,
  expectedOverrides: Record<string, string | null>,
): Promise<void> {
  const nodes = await tx<{ node_id: string; row_version: number | string }[]>`
   select node_id::text, row_version from organelle.nodes where tree_id = ${treeId} for update
 `;
  if (
    nodes.length !== Object.keys(expectedNodes).length ||
    nodes.some(
      (node) =>
        !Object.hasOwn(expectedNodes, node.node_id) ||
        Number(expectedNodes[node.node_id]) !== Number(node.row_version),
    )
  ) {
    throw new Error("race_conflict: sandbox structure changed");
  }
  const overrides = await tx<{ auth_id: string; updated_at: string }[]>`
   select auth_id::text, updated_at::text from organelle.employee_overrides where tree_id = ${treeId} for update
 `;
  if (
    overrides.length !== Object.keys(expectedOverrides).length ||
    overrides.some((row) => expectedOverrides[row.auth_id] !== row.updated_at)
  ) {
    throw new Error("race_conflict: sandbox employee edits changed");
  }
}
