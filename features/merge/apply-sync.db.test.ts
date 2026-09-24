import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

/**
 * apply_sync_to_sandbox optimistic locks and in-place write.
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run features/merge/apply-sync.db.test.ts
 */

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_URL ? describe : describe.skip;
const sql = TEST_URL ? postgres(TEST_URL, { max: 2, prepare: false }) : null;

function nodeId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

describeDb("organelle.apply_sync_to_sandbox", () => {
  beforeAll(async () => {
    await sql!`select 1`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("writes sandbox in place and advances fork pointer", async () => {
    const published = await sql!<{ tree_id: string; version_seq: number }[]>`
      select tree_id, version_seq from organelle.trees where kind = 'published'
    `;
    if (published.length !== 1) return;
    const live = published[0]!;
    const actor = "00000000-0000-4000-8000-000000000001";
    const root = nodeId(1);
    const child = nodeId(2);

    const sandbox = await sql!<{ tree_id: string }[]>`
      insert into organelle.trees
        (kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
      values ('sandbox', 'sync-test', ${actor}::uuid, ${actor}::uuid, ${live.tree_id}, ${live.version_seq - 1})
      returning tree_id
    `;
    const sandboxId = sandbox[0]!.tree_id;

    await sql!`
      insert into organelle.nodes
        (tree_id, node_id, parent_node_id, node_type, sort_order, name)
      select ${sandboxId}, node_id, parent_node_id, node_type, sort_order, name
      from organelle.nodes where tree_id = ${live.tree_id}
    `;

    const sandboxNode = await sql!<{ node_id: string; row_version: number }[]>`
      select node_id, row_version from organelle.nodes
      where tree_id = ${sandboxId} and parent_node_id is null
    `;
    if (!sandboxNode[0]) return;

    const snapshot = {
      direction: "sandbox",
      expectedLiveSeq: live.version_seq,
      expectedNodeVersions: { [sandboxNode[0].node_id]: sandboxNode[0].row_version },
      nodes: [
        {
          node_id: root,
          parent_node_id: null,
          node_type: "header",
          sort_order: 0,
          name: "Publisher synced",
          job_title: null,
          position_level: null,
          is_assistant: false,
          leaf_grid_columns: 3,
        },
        {
          node_id: child,
          parent_node_id: root,
          node_type: "header",
          sort_order: 0,
          name: "Finance",
          job_title: null,
          position_level: null,
          is_assistant: false,
          leaf_grid_columns: 3,
        },
      ],
      assignments: [],
      logs: [],
    };

    const sync = await sql!<{ sync_id: string }[]>`
      insert into organelle.sandbox_syncs
        (sandbox_tree_id, forked_from_seq, target_seq, actor_auth_id, snapshot, counts)
      values (
        ${sandboxId}, ${live.version_seq - 1}, ${live.version_seq}, ${actor}::uuid,
        ${sql!.json(snapshot)}, ${sql!.json({ moves: 0, edits: 0, creates: 0, deletes: 0, peers: 0 })}
      )
      returning sync_id
    `;

    const result = await sql!<{ apply_sync_to_sandbox: string }[]>`
      select organelle.apply_sync_to_sandbox(${sync[0]!.sync_id}::uuid, ${actor}::uuid)
    `;
    expect(result[0]!.apply_sync_to_sandbox).toBe(sandboxId);

    const forked = await sql!<
      { forked_from_seq: number; forked_from_tree_id: string }[]
    >`
      select forked_from_seq, forked_from_tree_id::text
      from organelle.trees where tree_id = ${sandboxId}
    `;
    expect(forked[0]!.forked_from_seq).toBe(live.version_seq);
    expect(forked[0]!.forked_from_tree_id).toBe(live.tree_id);

    const rootName = await sql!<{ name: string }[]>`
      select name from organelle.nodes
      where tree_id = ${sandboxId} and parent_node_id is null
    `;
    expect(rootName[0]!.name).toBe("Publisher synced");

    const pubCount = await sql!<{ n: number }[]>`
      select count(*)::int as n from organelle.trees where kind = 'published'
    `;
    expect(pubCount[0]!.n).toBe(1);

    await sql!`delete from organelle.sandbox_syncs where sandbox_tree_id = ${sandboxId}`;
    await sql!`delete from organelle.trees where tree_id = ${sandboxId}`;
  });

  it("raises race_conflict on sandbox row_version mismatch", async () => {
    const published = await sql!<{ tree_id: string; version_seq: number }[]>`
      select tree_id, version_seq from organelle.trees where kind = 'published'
    `;
    if (published.length !== 1) return;
    const live = published[0]!;
    const actor = "00000000-0000-4000-8000-000000000001";

    const sandbox = await sql!<{ tree_id: string }[]>`
      insert into organelle.trees
        (kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
      values ('sandbox', 'sync-race', ${actor}::uuid, ${actor}::uuid, ${live.tree_id}, ${live.version_seq})
      returning tree_id
    `;
    const sandboxId = sandbox[0]!.tree_id;

    const snapshot = {
      direction: "sandbox",
      expectedLiveSeq: live.version_seq,
      expectedNodeVersions: { [nodeId(99)]: 999 },
      nodes: [],
      assignments: [],
      logs: [],
    };

    const sync = await sql!<{ sync_id: string }[]>`
      insert into organelle.sandbox_syncs
        (sandbox_tree_id, forked_from_seq, target_seq, actor_auth_id, snapshot, counts)
      values (
        ${sandboxId}, ${live.version_seq}, ${live.version_seq}, ${actor}::uuid,
        ${sql!.json(snapshot)}, ${sql!.json({ moves: 0, edits: 0, creates: 0, deletes: 0, peers: 0 })}
      )
      returning sync_id
    `;

    await expect(
      sql!`select organelle.apply_sync_to_sandbox(${sync[0]!.sync_id}::uuid, ${actor}::uuid)`,
    ).rejects.toThrow(/race_conflict/);

    await sql!`delete from organelle.sandbox_syncs where sandbox_tree_id = ${sandboxId}`;
    await sql!`delete from organelle.trees where tree_id = ${sandboxId}`;
  });

  it("preserves pending employee overrides when the origin node survives sync", async () => {
    const published = await sql!<{ tree_id: string; version_seq: number }[]>`
      select tree_id, version_seq from organelle.trees where kind = 'published'
    `;
    if (published.length !== 1) return;
    const live = published[0]!;
    const actor = "00000000-0000-4000-8000-000000000001";
    const employeeAuth = crypto.randomUUID();
    const sandboxId = crypto.randomUUID();
    const root = nodeId(41);
    const seat = nodeId(42);
    const email = `sync-${employeeAuth.slice(0, 8)}@example.com`;

    await sql!
      .begin(async (tx) => {
        await tx`
        insert into organelle.employees (auth_id, email, full_name, status)
        values (${employeeAuth}, ${email}, 'Sync Person', 'active')
      `;
        await tx`
        insert into organelle.trees
          (tree_id, kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
        values (
          ${sandboxId}, 'sandbox', 'sync-overrides', ${actor}, ${actor},
          ${live.tree_id}, ${live.version_seq - 1}
        )
      `;
        await tx`
        insert into organelle.nodes
          (tree_id, node_id, parent_node_id, node_type, sort_order, name, job_title)
        values
          (${sandboxId}, ${root}, null, 'header', 0, 'Root', null),
          (${sandboxId}, ${seat}, ${root}, 'seat', 0, null, 'Engineer')
      `;
        await tx`
        insert into organelle.employee_overrides (
          tree_id, node_id, auth_id, display_name, display_title, avatar_url,
          status, updated_by
        ) values (
          ${sandboxId}, ${seat}, ${employeeAuth}, 'Pending Name', 'Pending Title',
          null, 'active', ${actor}
        )
      `;
        const rootVersion = await tx<{ row_version: number }[]>`
        select row_version from organelle.nodes
        where tree_id = ${sandboxId} and node_id = ${root}
      `;

        const snapshot = {
          direction: "sandbox",
          expectedLiveSeq: live.version_seq,
          expectedNodeVersions: { [root]: rootVersion[0]!.row_version },
          nodes: [
            {
              node_id: root,
              parent_node_id: null,
              node_type: "header",
              sort_order: 0,
              name: "Root synced",
              job_title: null,
              position_level: null,
              is_assistant: false,
              leaf_grid_columns: 3,
            },
            {
              node_id: seat,
              parent_node_id: root,
              node_type: "seat",
              sort_order: 0,
              name: null,
              job_title: "Engineer",
              position_level: null,
              is_assistant: false,
              leaf_grid_columns: 3,
            },
          ],
          assignments: [],
          employeeOverrides: [
            {
              auth_id: employeeAuth,
              node_id: seat,
              display_name: "Pending Name",
              display_title: "Pending Title",
              avatar_url: null,
              legal_full_name: null,
              office_country: null,
              office_location: null,
              hiring_company: null,
              status: "active",
              joining_date: null,
              hired_at: null,
              resignation_date: null,
              last_working_date: null,
              external_id: null,
              employment_record: null,
              position_level: null,
              primary_manager_auth_id: null,
              primary_team_path: null,
            },
          ],
          logs: [],
        };
        const sync = await tx<{ sync_id: string }[]>`
        insert into organelle.sandbox_syncs
          (sandbox_tree_id, forked_from_seq, target_seq, actor_auth_id, snapshot, counts)
        values (
          ${sandboxId}, ${live.version_seq - 1}, ${live.version_seq}, ${actor},
          ${tx.json(snapshot)}, ${tx.json({ edits: 1 })}
        )
        returning sync_id
      `;

        await tx`select organelle.apply_sync_to_sandbox(${sync[0]!.sync_id}::uuid, ${actor}::uuid)`;

        const pending = await tx<{ display_name: string | null }[]>`
        select display_name
          from organelle.employee_overrides
         where tree_id = ${sandboxId} and auth_id = ${employeeAuth}
      `;
        expect(pending[0]?.display_name).toBe("Pending Name");

        throw new Error("rollback sync override preservation test");
      })
      .catch((err: Error) => {
        if (err.message !== "rollback sync override preservation test") throw err;
      });
  });
});
