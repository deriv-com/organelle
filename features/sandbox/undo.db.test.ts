import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { applyCommandSql } from "./command-sql";
import type { CommandLogRow } from "./command-stack";

/**
 * Inverse SQL for a move_node command.
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run features/sandbox/undo.db.test.ts
 */

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_URL ? describe : describe.skip;
const sql = TEST_URL ? postgres(TEST_URL, { max: 2, prepare: false }) : null;

function nodeId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

describeDb("applyCommandSql inverse", () => {
  beforeAll(async () => {
    await sql!`select 1`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("restores a moved header and keeps node_id", async () => {
    const published = await sql!<{ tree_id: string; version_seq: number }[]>`
      select tree_id, version_seq from organelle.trees where kind = 'published'
    `;
    if (published.length !== 1) return;
    const actor = "00000000-0000-4000-8000-000000000001";
    const treeId = crypto.randomUUID();
    const root = nodeId(1);
    const teamA = nodeId(2);
    const teamB = nodeId(3);
    await sql!`
      insert into organelle.trees
        (tree_id, kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
      values (
        ${treeId}, 'sandbox', 'undo-test', ${actor}, ${actor},
        ${published[0]!.tree_id}, ${published[0]!.version_seq}
      )
    `;
    await sql!`
      insert into organelle.nodes
        (tree_id, node_id, parent_node_id, node_type, sort_order, name)
      values
        (${treeId}, ${root}, null, 'header', 0, 'Root'),
        (${treeId}, ${teamA}, ${root}, 'header', 0, 'A'),
        (${treeId}, ${teamB}, ${root}, 'header', 1, 'B')
    `;
    await sql!`
      update organelle.nodes
         set parent_node_id = ${teamB}, sort_order = 0
       where tree_id = ${treeId} and node_id = ${teamA}
    `;
    const log: CommandLogRow[] = [
      {
        op: "move_node",
        node_id: teamA,
        employee_auth_id: null,
        before: { parent_node_id: root, sort_order: 0 },
        after: { parent_node_id: teamB, sort_order: 0 },
      },
    ];
    await sql!.begin(async (tx) => {
      await applyCommandSql(tx, treeId, log, "inverse");
      await tx`select organelle.validate_tree(${treeId})`;
    });
    const [row] = await sql!<{ parent_node_id: string }[]>`
      select parent_node_id::text as parent_node_id
        from organelle.nodes
       where tree_id = ${treeId} and node_id = ${teamA}
    `;
    expect(row?.parent_node_id).toBe(root);
    await sql!`delete from organelle.trees where tree_id = ${treeId}`;
  });
});
