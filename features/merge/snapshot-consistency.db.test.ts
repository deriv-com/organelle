import postgres from "postgres";
import { expect, it } from "vitest";
import { assertSandboxSnapshotUnchanged } from "./snapshot-consistency";
const url = process.env.TEST_DATABASE_URL;
it.skipIf(!url)(
  "rejects a collaborator's new node added after the sync snapshot was read",
  async () => {
    const sql = postgres(url!, { max: 1, prepare: false });
    const writer = postgres(url!, { max: 1, prepare: false });
    const tree = crypto.randomUUID(),
      root = crypto.randomUUID(),
      child = crypto.randomUUID(),
      actor = crypto.randomUUID();
    try {
      await sql`insert into organelle.employees (auth_id, email, full_name, status) values (${actor}, ${`snapshot-${actor}@example.com`}, 'Example Editor', 'active')`;
      const bases = await sql<
        { tree_id: string; version_seq: number }[]
      >`select tree_id, version_seq from organelle.trees where kind = 'published'`;
      expect(bases).toHaveLength(1);
      await sql`insert into organelle.trees (tree_id, kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq) values (${tree}, 'sandbox', 'Snapshot regression', ${actor}, ${actor}, ${bases[0]!.tree_id}, ${bases[0]!.version_seq})`;
      await sql`insert into organelle.nodes (tree_id, node_id, node_type, name, sort_order) values (${tree}, ${root}, 'header', 'Example Organization', 0)`;
      const snapshot = await sql<
        { node_id: string; row_version: number }[]
      >`select node_id::text, row_version from organelle.nodes where tree_id = ${tree}`;
      await writer.begin(async (tx) => {
        await tx`select tree_id from organelle.trees where tree_id = ${tree} for update`;
        await tx`insert into organelle.nodes (tree_id, node_id, parent_node_id, node_type, name, sort_order) values (${tree}, ${child}, ${root}, 'header', 'New Team', 0)`;
      });
      await expect(
        sql.begin(async (tx) => {
          await tx`select tree_id from organelle.trees where tree_id = ${tree} for update`;
          await assertSandboxSnapshotUnchanged(
            tx,
            tree,
            Object.fromEntries(snapshot.map((n) => [n.node_id, n.row_version])),
            {},
          );
        }),
      ).rejects.toThrow("race_conflict");
      expect(
        await sql`select node_id from organelle.nodes where tree_id = ${tree} and node_id = ${child}`,
      ).toHaveLength(1);
    } finally {
      await sql`delete from organelle.trees where tree_id = ${tree}`;
      await sql`delete from organelle.employees where auth_id = ${actor}`;
      await Promise.all([sql.end(), writer.end()]);
    }
  },
);
