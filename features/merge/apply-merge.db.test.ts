import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

/**
 * apply_merge optimistic locks and rollback.
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run features/merge
 */

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_URL ? describe : describe.skip;
const sql = TEST_URL ? postgres(TEST_URL, { max: 2, prepare: false }) : null;

function nodeId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

describeDb("organelle.apply_merge", () => {
  beforeAll(async () => {
    await sql!`select 1`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("publishes a snapshot and rolls back when the test aborts", async () => {
    const published = await sql!<{ tree_id: string; version_seq: number }[]>`
      select tree_id, version_seq from organelle.trees where kind = 'published'
    `;
    if (published.length !== 1) return;
    const live = published[0]!;
    const liveNode = (
      await sql!<{ node_id: string; row_version: number }[]>`
        select node_id, row_version from organelle.nodes
        where tree_id = ${live.tree_id} and parent_node_id is null
      `
    )[0];
    if (!liveNode) return;

    const actor = "00000000-0000-4000-8000-000000000001";
    const root = nodeId(1);
    const child = nodeId(2);
    const snapshot = {
      expectedLiveSeq: live.version_seq,
      expectedNodeVersions: { [liveNode.node_id]: liveNode.row_version },
      nodes: [
        {
          node_id: root,
          parent_node_id: null,
          node_type: "header",
          sort_order: 0,
          name: "Publisher",
          job_title: null,
          position_level: null,
        },
        {
          node_id: child,
          parent_node_id: root,
          node_type: "header",
          sort_order: 0,
          name: "Finance",
          job_title: null,
          position_level: null,
        },
      ],
      assignments: [],
      logs: [],
    };

    await expect(
      sql!.begin(async (tx) => {
        const sandbox = await tx<{ tree_id: string }[]>`
          insert into organelle.trees
            (kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
          values ('sandbox', 'apply-merge-test', ${actor}::uuid, ${actor}::uuid, ${live.tree_id}, ${live.version_seq})
          returning tree_id
        `;
        const merge = await tx<{ merge_id: string }[]>`
          insert into organelle.sandbox_merges
            (sandbox_tree_id, forked_from_seq, target_seq, merger_auth_id, title, snapshot, counts)
          values (
            ${sandbox[0]!.tree_id}, ${live.version_seq}, ${live.version_seq}, ${actor}::uuid,
            'test', ${tx.json(snapshot)}, ${tx.json({ moves: 0, edits: 0, creates: 0, deletes: 0, peers: 0 })}
          )
          returning merge_id
        `;
        const result = await tx<{ apply_merge: string }[]>`
          select organelle.apply_merge(${merge[0]!.merge_id}::uuid, ${actor}::uuid)
        `;
        expect(result[0]!.apply_merge).toBeTruthy();
        const kinds = await tx<{ kind: string }[]>`
          select kind::text from organelle.trees where kind = 'published'
        `;
        expect(kinds).toHaveLength(1);
        throw new Error("ROLLBACK");
      }),
    ).rejects.toThrow(/ROLLBACK/);

    const still = await sql!<{ n: number }[]>`
      select count(*)::int as n from organelle.trees where kind = 'published'
    `;
    expect(still[0]!.n).toBe(1);
  });

  it("raises race_conflict on seq mismatch and leaves status pending", async () => {
    const published = await sql!<{ tree_id: string; version_seq: number }[]>`
      select tree_id, version_seq from organelle.trees where kind = 'published'
    `;
    if (published.length !== 1) return;
    const live = published[0]!;
    const actor = "00000000-0000-4000-8000-000000000001";
    const emptySnap = {
      expectedLiveSeq: live.version_seq + 1,
      expectedNodeVersions: {},
      nodes: [],
      assignments: [],
      logs: [],
    };

    const sandbox = await sql!<{ tree_id: string }[]>`
      insert into organelle.trees
        (kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
      values ('sandbox', 'seq-race', ${actor}::uuid, ${actor}::uuid, ${live.tree_id}, ${live.version_seq})
      returning tree_id
    `;
    const merge = await sql!<{ merge_id: string; status: string }[]>`
      insert into organelle.sandbox_merges
        (sandbox_tree_id, forked_from_seq, target_seq, merger_auth_id, snapshot)
      values (
        ${sandbox[0]!.tree_id}, ${live.version_seq}, ${live.version_seq + 1}, ${actor}::uuid,
        ${sql!.json(emptySnap)}
      )
      returning merge_id, status::text
    `;
    expect(merge[0]!.status).toBe("pending");

    await expect(
      sql!`select organelle.apply_merge(${merge[0]!.merge_id}::uuid, ${actor}::uuid)`,
    ).rejects.toThrow(/race_conflict/);

    const after = await sql!<{ status: string }[]>`
      select status::text from organelle.sandbox_merges where merge_id = ${merge[0]!.merge_id}
    `;
    expect(after[0]!.status).toBe("pending");

    await sql!`delete from organelle.sandbox_merges where merge_id = ${merge[0]!.merge_id}`;
    await sql!`delete from organelle.trees where tree_id = ${sandbox[0]!.tree_id}`;
  });

  it("raises race_conflict on row_version mismatch", async () => {
    const published = await sql!<{ tree_id: string; version_seq: number }[]>`
      select tree_id, version_seq from organelle.trees where kind = 'published'
    `;
    if (published.length !== 1) return;
    const live = published[0]!;
    const liveNode = (
      await sql!<{ node_id: string }[]>`
        select node_id from organelle.nodes
        where tree_id = ${live.tree_id} and parent_node_id is null
      `
    )[0];
    if (!liveNode) return;
    const actor = "00000000-0000-4000-8000-000000000001";

    const snap = {
      expectedLiveSeq: live.version_seq,
      expectedNodeVersions: { [liveNode.node_id]: 999999 },
      nodes: [],
      assignments: [],
      logs: [],
    };
    const sandbox = await sql!<{ tree_id: string }[]>`
      insert into organelle.trees
        (kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
      values ('sandbox', 'ver-race', ${actor}::uuid, ${actor}::uuid, ${live.tree_id}, ${live.version_seq})
      returning tree_id
    `;
    const merge = await sql!<{ merge_id: string }[]>`
      insert into organelle.sandbox_merges
        (sandbox_tree_id, forked_from_seq, target_seq, merger_auth_id, snapshot)
      values (
        ${sandbox[0]!.tree_id}, ${live.version_seq}, ${live.version_seq}, ${actor}::uuid,
        ${sql!.json(snap)}
      )
      returning merge_id
    `;

    await expect(
      sql!`select organelle.apply_merge(${merge[0]!.merge_id}::uuid, ${actor}::uuid)`,
    ).rejects.toThrow(/race_conflict/);

    const after = await sql!<{ status: string }[]>`
      select status::text from organelle.sandbox_merges where merge_id = ${merge[0]!.merge_id}
    `;
    expect(after[0]!.status).toBe("pending");

    await sql!`delete from organelle.sandbox_merges where merge_id = ${merge[0]!.merge_id}`;
    await sql!`delete from organelle.trees where tree_id = ${sandbox[0]!.tree_id}`;
  });

  it("rolls back an invalid snapshot (two roots) and leaves one published tree", async () => {
    const published = await sql!<{ tree_id: string; version_seq: number }[]>`
      select tree_id, version_seq from organelle.trees where kind = 'published'
    `;
    if (published.length !== 1) return;
    const live = published[0]!;
    const actor = "00000000-0000-4000-8000-000000000001";
    const snapshot = {
      expectedLiveSeq: live.version_seq,
      expectedNodeVersions: {},
      nodes: [
        {
          node_id: nodeId(11),
          parent_node_id: null,
          node_type: "header",
          sort_order: 0,
          name: "A",
          job_title: null,
          position_level: null,
        },
        {
          node_id: nodeId(12),
          parent_node_id: null,
          node_type: "header",
          sort_order: 0,
          name: "B",
          job_title: null,
          position_level: null,
        },
      ],
      assignments: [],
      logs: [],
    };

    const sandbox = await sql!<{ tree_id: string }[]>`
      insert into organelle.trees
        (kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
      values ('sandbox', 'invalid-snap', ${actor}::uuid, ${actor}::uuid, ${live.tree_id}, ${live.version_seq})
      returning tree_id
    `;
    const merge = await sql!<{ merge_id: string }[]>`
      insert into organelle.sandbox_merges
        (sandbox_tree_id, forked_from_seq, target_seq, merger_auth_id, snapshot)
      values (
        ${sandbox[0]!.tree_id}, ${live.version_seq}, ${live.version_seq}, ${actor}::uuid,
        ${sql!.json(snapshot)}
      )
      returning merge_id
    `;

    await expect(
      sql!`select organelle.apply_merge(${merge[0]!.merge_id}::uuid, ${actor}::uuid)`,
    ).rejects.toThrow();

    const still = await sql!<{ n: number }[]>`
      select count(*)::int as n from organelle.trees where kind = 'published'
    `;
    expect(still[0]!.n).toBe(1);
    const after = await sql!<{ status: string }[]>`
      select status::text from organelle.sandbox_merges where merge_id = ${merge[0]!.merge_id}
    `;
    expect(after[0]!.status).toBe("pending");

    await sql!`delete from organelle.sandbox_merges where merge_id = ${merge[0]!.merge_id}`;
    await sql!`delete from organelle.trees where tree_id = ${sandbox[0]!.tree_id}`;
  });

  it("deleting a merged sandbox nulls sandbox_tree_id and keeps the merge row", async () => {
    const published = await sql!<{ tree_id: string; version_seq: number }[]>`
      select tree_id, version_seq from organelle.trees where kind = 'published'
    `;
    if (published.length !== 1) return;
    const live = published[0]!;
    const actor = "00000000-0000-4000-8000-000000000001";

    const sandbox = await sql!<{ tree_id: string }[]>`
      insert into organelle.trees
        (kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
      values ('sandbox', 'delete-after-merge', ${actor}::uuid, ${actor}::uuid, ${live.tree_id}, ${live.version_seq})
      returning tree_id
    `;
    const merge = await sql!<{ merge_id: string }[]>`
      insert into organelle.sandbox_merges
        (sandbox_tree_id, forked_from_seq, target_seq, merger_auth_id, status, title, snapshot)
      values (
        ${sandbox[0]!.tree_id}, ${live.version_seq}, ${live.version_seq}, ${actor}::uuid,
        'merged', 'kept', ${sql!.json({ expectedLiveSeq: live.version_seq, expectedNodeVersions: {}, nodes: [], assignments: [], logs: [] })}
      )
      returning merge_id
    `;

    await sql!`delete from organelle.trees where tree_id = ${sandbox[0]!.tree_id}`;

    const after = await sql!<
      { sandbox_tree_id: string | null; title: string | null }[]
    >`
      select sandbox_tree_id, title from organelle.sandbox_merges
      where merge_id = ${merge[0]!.merge_id}
    `;
    expect(after).toHaveLength(1);
    expect(after[0]!.sandbox_tree_id).toBeNull();
    expect(after[0]!.title).toBe("kept");

    await sql!`delete from organelle.sandbox_merges where merge_id = ${merge[0]!.merge_id}`;
  });

  it("promotes sandbox employee overrides and deletes the pending rows", async () => {
    const published = await sql!<{ tree_id: string; version_seq: number }[]>`
      select tree_id, version_seq from organelle.trees where kind = 'published'
    `;
    if (published.length !== 1) return;
    const live = published[0]!;
    const actor = "00000000-0000-4000-8000-000000000001";
    const employeeAuth = crypto.randomUUID();
    const sandboxId = crypto.randomUUID();
    const root = nodeId(31);
    const seat = nodeId(32);
    const email = `before-${employeeAuth.slice(0, 8)}@example.com`;

    await sql!
      .begin(async (tx) => {
        await tx`
        insert into organelle.employees (auth_id, email, full_name, job_title, status)
        values (${employeeAuth}, ${email}, 'Before Name', 'Before Title', 'active')
      `;
        await tx`
        insert into organelle.trees
          (tree_id, kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
        values (
          ${sandboxId}, 'sandbox', 'employee-overrides', ${actor}, ${actor},
          ${live.tree_id}, ${live.version_seq}
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
        insert into organelle.seat_assignments
          (tree_id, node_id, employee_auth_id, is_host, is_primary)
        values (${sandboxId}, ${seat}, ${employeeAuth}, true, true)
      `;
        await tx`
        insert into organelle.employee_overrides (
          tree_id, node_id, auth_id, display_name, display_title, avatar_url,
          status, updated_by
        ) values (
          ${sandboxId}, ${seat}, ${employeeAuth}, 'After Name', 'After Title', null,
          'active', ${actor}
        )
      `;

        const snapshot = {
          expectedLiveSeq: live.version_seq,
          expectedNodeVersions: {},
          nodes: [
            {
              node_id: root,
              parent_node_id: null,
              node_type: "header",
              sort_order: 0,
              name: "Root",
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
          assignments: [
            {
              node_id: seat,
              employee_auth_id: employeeAuth,
              is_host: true,
              is_primary: true,
            },
          ],
          employeeOverrides: [
            {
              auth_id: employeeAuth,
              node_id: seat,
              display_name: "After Name",
              display_title: "After Title",
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
        const merge = await tx<{ merge_id: string }[]>`
        insert into organelle.sandbox_merges
          (sandbox_tree_id, forked_from_seq, target_seq, merger_auth_id, title, snapshot, counts)
        values (
          ${sandboxId}, ${live.version_seq}, ${live.version_seq}, ${actor},
          'employee override merge', ${tx.json(snapshot)}, ${tx.json({ edits: 1 })}
        )
        returning merge_id
      `;

        await tx`select organelle.apply_merge(${merge[0]!.merge_id}::uuid, ${actor}::uuid)`;

        const employee = await tx<{ full_name: string | null; email: string | null }[]>`
        select full_name, email from organelle.employees where auth_id = ${employeeAuth}
      `;
        expect(employee[0]).toMatchObject({
          full_name: "After Name",
          email,
        });

        const pending = await tx<{ n: number }[]>`
        select count(*)::int as n
          from organelle.employee_overrides
         where tree_id = ${sandboxId}
      `;
        expect(pending[0]!.n).toBe(0);

        const logs = await tx<{ n: number }[]>`
        select count(*)::int as n
          from organelle.change_log
         where merge_id = ${merge[0]!.merge_id}
           and op = 'update_employee'
           and employee_auth_id = ${employeeAuth}
      `;
        expect(logs[0]!.n).toBe(1);

        throw new Error("rollback employee override merge test");
      })
      .catch((err: Error) => {
        if (err.message !== "rollback employee override merge test") throw err;
      });
  });

  it("archives a sandbox via archived_at and clears on restore", async () => {
    const published = await sql!<{ tree_id: string; version_seq: number }[]>`
      select tree_id, version_seq from organelle.trees where kind = 'published'
    `;
    if (published.length !== 1) return;
    const live = published[0]!;
    const actor = "00000000-0000-4000-8000-000000000001";

    const sandbox = await sql!<{ tree_id: string }[]>`
      insert into organelle.trees
        (kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
      values ('sandbox', 'archive-lifecycle', ${actor}::uuid, ${actor}::uuid, ${live.tree_id}, ${live.version_seq})
      returning tree_id
    `;
    const treeId = sandbox[0]!.tree_id;

    await sql!`
      update organelle.trees
      set archived_at = coalesce(archived_at, now())
      where tree_id = ${treeId} and kind = 'sandbox'
    `;
    const archived = await sql!<{ archived_at: string | null }[]>`
      select archived_at::text from organelle.trees where tree_id = ${treeId}
    `;
    expect(archived[0]!.archived_at).not.toBeNull();

    await sql!`
      update organelle.trees
      set archived_at = null
      where tree_id = ${treeId} and kind = 'sandbox'
    `;
    const restored = await sql!<{ archived_at: string | null }[]>`
      select archived_at::text from organelle.trees where tree_id = ${treeId}
    `;
    expect(restored[0]!.archived_at).toBeNull();

    await sql!`delete from organelle.trees where tree_id = ${treeId}`;
  });
});
