import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { applyCommandSql } from "./command-sql";
import type { CommandLogRow } from "./command-stack";
import type { DraftEmployeeSnapshot } from "./draft-employees";

/**
 * Sandbox draft employees.
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *   npx vitest run features/sandbox/draft-employees.db.test.ts
 */

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_URL ? describe : describe.skip;
const sql = TEST_URL ? postgres(TEST_URL, { max: 2, prepare: false }) : null;

function nodeId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

describeDb("sandbox draft employees", () => {
  beforeAll(async () => {
    await sql!`select 1`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("scopes drafts to one sandbox, deletes on last seat, cascades on tree delete", async () => {
    const published = await sql!<{ tree_id: string; version_seq: number }[]>`
      select tree_id, version_seq from organelle.trees where kind = 'published'
    `;
    if (published.length !== 1) return;
    const actors = await sql!<{ auth_id: string }[]>`
      select auth_id from organelle.employees where sandbox_tree_id is null limit 1
    `;
    if (!actors[0]) return;
    const actor = actors[0].auth_id;
    const treeA = crypto.randomUUID();
    const treeB = crypto.randomUUID();
    const root = nodeId(1);
    const seat = nodeId(2);
    const draftAuth = crypto.randomUUID();
    const email = `draft-${draftAuth.slice(0, 8)}@example.com`;

    await sql!`
      insert into organelle.trees
        (tree_id, kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
      values
        (
          ${treeA}, 'sandbox', 'draft-a', ${actor}, ${actor},
          ${published[0]!.tree_id}, ${published[0]!.version_seq}
        ),
        (
          ${treeB}, 'sandbox', 'draft-b', ${actor}, ${actor},
          ${published[0]!.tree_id}, ${published[0]!.version_seq}
        )
    `;
    await sql!`
      insert into organelle.nodes
        (tree_id, node_id, parent_node_id, node_type, sort_order, name, job_title)
      values
        (${treeA}, ${root}, null, 'header', 0, 'Root', null),
        (${treeA}, ${seat}, ${root}, 'seat', 0, null, 'Engineer')
    `;
    await sql!`
      insert into organelle.employees (
        auth_id, email, full_name, status, sandbox_tree_id
      ) values (
        ${draftAuth}, ${email}, 'Draft Person', 'active', ${treeA}
      )
    `;
    await sql!`
      insert into organelle.seat_assignments
        (tree_id, node_id, employee_auth_id, is_host, is_primary)
      values (${treeA}, ${seat}, ${draftAuth}, true, true)
    `;
    await sql!`
      insert into organelle.employee_overrides (
        tree_id, node_id, auth_id, display_name, display_title, avatar_url,
        status, updated_by
      ) values (
        ${treeA}, ${seat}, ${draftAuth}, 'Draft Override', 'Draft Title', null,
        'active', ${actor}
      )
    `;

    const inA = await sql!<{ n: number }[]>`
      select count(*)::int as n from organelle.employees
      where (sandbox_tree_id is null or sandbox_tree_id = ${treeA})
        and auth_id = ${draftAuth}
    `;
    const inB = await sql!<{ n: number }[]>`
      select count(*)::int as n from organelle.employees
      where (sandbox_tree_id is null or sandbox_tree_id = ${treeB})
        and auth_id = ${draftAuth}
    `;
    expect(inA[0]?.n).toBe(1);
    expect(inB[0]?.n).toBe(0);

    await sql!`
      delete from organelle.nodes
      where tree_id = ${treeA} and node_id = ${seat}
    `;
    const overrideAfterNodeDelete = await sql!<{ n: number }[]>`
      select count(*)::int as n
        from organelle.employee_overrides
       where tree_id = ${treeA} and auth_id = ${draftAuth}
    `;
    expect(overrideAfterNodeDelete[0]?.n).toBe(0);
    await sql!`
      delete from organelle.employees e
      where e.auth_id = ${draftAuth}
        and e.sandbox_tree_id = ${treeA}
        and not exists (
          select 1 from organelle.seat_assignments sa
          where sa.tree_id = ${treeA} and sa.employee_auth_id = ${draftAuth}
        )
    `;
    const afterDelete = await sql!<{ n: number }[]>`
      select count(*)::int as n from organelle.employees where auth_id = ${draftAuth}
    `;
    expect(afterDelete[0]?.n).toBe(0);

    const draft2 = crypto.randomUUID();
    await sql!`
      insert into organelle.employees (
        auth_id, email, full_name, status, sandbox_tree_id
      ) values (
        ${draft2}, ${`draft2-${draft2.slice(0, 8)}@example.com`}, 'Gone', 'active', ${treeA}
      )
    `;
    await sql!`delete from organelle.trees where tree_id = ${treeA}`;
    const cascaded = await sql!<{ n: number }[]>`
      select count(*)::int as n from organelle.employees where auth_id = ${draft2}
    `;
    expect(cascaded[0]?.n).toBe(0);

    await sql!`delete from organelle.trees where tree_id = ${treeB}`;
  });

  it("undo create_seat removes a draft; redo restores them", async () => {
    const published = await sql!<{ tree_id: string; version_seq: number }[]>`
      select tree_id, version_seq from organelle.trees where kind = 'published'
    `;
    if (published.length !== 1) return;
    const actor = "00000000-0000-4000-8000-000000000001";
    const treeId = crypto.randomUUID();
    const root = nodeId(1);
    const seat = nodeId(2);
    const draftAuth = crypto.randomUUID();
    const email = `redo-${draftAuth.slice(0, 8)}@example.com`;
    const snap: DraftEmployeeSnapshot = {
      auth_id: draftAuth,
      email,
      full_name: "Redo Person",
      legal_full_name: null,
      id: null,
      employment_record: null,
      job_title: "IC",
      position_level: null,
      avatar_url: null,
      office_country: null,
      office_location: null,
      hiring_company: null,
      status: "active",
      joining_date: null,
      hired_at: null,
      resignation_date: null,
      last_working_date: null,
    };

    await sql!`
      insert into organelle.trees
        (tree_id, kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
      values (
        ${treeId}, 'sandbox', 'redo-draft', ${actor}, ${actor},
        ${published[0]!.tree_id}, ${published[0]!.version_seq}
      )
    `;
    await sql!`
      insert into organelle.nodes
        (tree_id, node_id, parent_node_id, node_type, sort_order, name, job_title)
      values
        (${treeId}, ${root}, null, 'header', 0, 'Root', null),
        (${treeId}, ${seat}, ${root}, 'seat', 0, null, 'IC')
    `;
    await sql!`
      insert into organelle.employees (
        auth_id, email, full_name, status, job_title, sandbox_tree_id
      ) values (
        ${draftAuth}, ${email}, 'Redo Person', 'active', 'IC', ${treeId}
      )
    `;
    await sql!`
      insert into organelle.seat_assignments
        (tree_id, node_id, employee_auth_id, is_host, is_primary)
      values (${treeId}, ${seat}, ${draftAuth}, true, true)
    `;

    const log: CommandLogRow[] = [
      {
        op: "create_seat",
        node_id: seat,
        employee_auth_id: draftAuth,
        before: null,
        after: {
          parent_node_id: root,
          job_title: "IC",
          sort_order: 0,
          draft_employee: snap,
        },
      },
    ];

    await sql!.begin(async (tx) => {
      await applyCommandSql(tx, treeId, log, "inverse");
    });
    const gone = await sql!<{ n: number }[]>`
      select count(*)::int as n from organelle.employees where auth_id = ${draftAuth}
    `;
    expect(gone[0]?.n).toBe(0);

    await sql!.begin(async (tx) => {
      await applyCommandSql(tx, treeId, log, "forward");
    });
    const back = await sql!<{ sandbox_tree_id: string | null }[]>`
      select sandbox_tree_id::text as sandbox_tree_id
        from organelle.employees where auth_id = ${draftAuth}
    `;
    expect(back[0]?.sandbox_tree_id).toBe(treeId);

    await sql!`delete from organelle.trees where tree_id = ${treeId}`;
  });

  it("apply_merge promotes drafts that still hold seats", async () => {
    const published = await sql!<{ tree_id: string; version_seq: number }[]>`
      select tree_id, version_seq from organelle.trees where kind = 'published'
    `;
    if (published.length !== 1) return;
    const live = published[0]!;
    const liveRoot = (
      await sql!<{ node_id: string; row_version: number }[]>`
        select node_id, row_version from organelle.nodes
        where tree_id = ${live.tree_id} and parent_node_id is null
      `
    )[0];
    if (!liveRoot) return;

    const actors = await sql!<{ auth_id: string }[]>`
      select auth_id from organelle.employees where sandbox_tree_id is null limit 1
    `;
    if (!actors[0]) return;
    const actor = actors[0].auth_id;
    const sandboxId = crypto.randomUUID();
    const root = nodeId(10);
    const seat = nodeId(11);
    const draftAuth = crypto.randomUUID();
    const email = `merge-${draftAuth.slice(0, 8)}@example.com`;

    await sql!
      .begin(async (tx) => {
        await tx`
        insert into organelle.trees
          (tree_id, kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
        values (
          ${sandboxId}, 'sandbox', 'promote-draft', ${actor}, ${actor},
          ${live.tree_id}, ${live.version_seq}
        )
      `;
        await tx`
        insert into organelle.employees (
          auth_id, email, full_name, status, sandbox_tree_id
        ) values (
          ${draftAuth}, ${email}, 'Merge Draft', 'active', ${sandboxId}
        )
      `;
        await tx`
        insert into organelle.nodes
          (tree_id, node_id, parent_node_id, node_type, sort_order, name, job_title)
        values
          (${sandboxId}, ${root}, null, 'seat', 0, null, 'Publisher'),
          (${sandboxId}, ${seat}, ${root}, 'seat', 0, null, 'Analyst')
      `;
        await tx`
        insert into organelle.seat_assignments
          (tree_id, node_id, employee_auth_id, is_host, is_primary)
        values
          (${sandboxId}, ${root}, ${actor}, true, true),
          (${sandboxId}, ${seat}, ${draftAuth}, true, true)
      `;

        const snapshot = {
          expectedLiveSeq: live.version_seq,
          expectedNodeVersions: { [liveRoot.node_id]: liveRoot.row_version },
          nodes: [
            {
              node_id: root,
              parent_node_id: null,
              node_type: "seat",
              sort_order: 0,
              name: null,
              job_title: "Publisher",
              position_level: null,
              is_assistant: false,
            },
            {
              node_id: seat,
              parent_node_id: root,
              node_type: "seat",
              sort_order: 0,
              name: null,
              job_title: "Analyst",
              position_level: null,
              is_assistant: false,
            },
          ],
          assignments: [
            {
              node_id: root,
              employee_auth_id: actor,
              is_host: true,
              is_primary: true,
            },
            {
              node_id: seat,
              employee_auth_id: draftAuth,
              is_host: true,
              is_primary: true,
            },
          ],
          logs: [],
        };

        const merge = await tx<{ merge_id: string }[]>`
        insert into organelle.sandbox_merges
          (sandbox_tree_id, forked_from_seq, target_seq, merger_auth_id, title, snapshot, counts)
        values (
          ${sandboxId}, ${live.version_seq}, ${live.version_seq}, ${actor},
          'promote drafts', ${tx.json(snapshot)}, '{}'::jsonb
        )
        returning merge_id
      `;

        await tx`select organelle.apply_merge(${merge[0]!.merge_id}, ${actor})`;

        const promoted = await tx<{ sandbox_tree_id: string | null }[]>`
        select sandbox_tree_id::text as sandbox_tree_id
          from organelle.employees where auth_id = ${draftAuth}
      `;
        expect(promoted[0]?.sandbox_tree_id).toBeNull();

        throw new Error("rollback promote-draft test");
      })
      .catch((err: Error) => {
        if (err.message !== "rollback promote-draft test") throw err;
      });
  });

  it("keeps a global employee after seat delete", async () => {
    const published = await sql!<{ tree_id: string; version_seq: number }[]>`
      select tree_id, version_seq from organelle.trees where kind = 'published'
    `;
    if (published.length !== 1) return;
    const actor = "00000000-0000-4000-8000-000000000001";
    const treeId = crypto.randomUUID();
    const root = nodeId(1);
    const seat = nodeId(2);
    const globalAuth = crypto.randomUUID();
    const email = `global-${globalAuth.slice(0, 8)}@example.com`;

    await sql!`
      insert into organelle.trees
        (tree_id, kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
      values (
        ${treeId}, 'sandbox', 'global-keep', ${actor}, ${actor},
        ${published[0]!.tree_id}, ${published[0]!.version_seq}
      )
    `;
    await sql!`
      insert into organelle.employees (auth_id, email, full_name, status)
      values (${globalAuth}, ${email}, 'Global', 'active')
    `;
    await sql!`
      insert into organelle.nodes
        (tree_id, node_id, parent_node_id, node_type, sort_order, name, job_title)
      values
        (${treeId}, ${root}, null, 'header', 0, 'Root', null),
        (${treeId}, ${seat}, ${root}, 'seat', 0, null, 'Role')
    `;
    await sql!`
      insert into organelle.seat_assignments
        (tree_id, node_id, employee_auth_id, is_host, is_primary)
      values (${treeId}, ${seat}, ${globalAuth}, true, true)
    `;
    await sql!`
      delete from organelle.nodes
      where tree_id = ${treeId} and node_id = ${seat}
    `;
    await sql!`
      delete from organelle.employees e
      where e.auth_id = ${globalAuth}
        and e.sandbox_tree_id = ${treeId}
        and not exists (
          select 1 from organelle.seat_assignments sa
          where sa.tree_id = ${treeId} and sa.employee_auth_id = ${globalAuth}
        )
    `;
    const kept = await sql!<{ n: number }[]>`
      select count(*)::int as n from organelle.employees where auth_id = ${globalAuth}
    `;
    expect(kept[0]?.n).toBe(1);

    await sql!`delete from organelle.employees where auth_id = ${globalAuth}`;
    await sql!`delete from organelle.trees where tree_id = ${treeId}`;
  });

  it("rejects a draft email that collides with a global employee", async () => {
    const published = await sql!<{ tree_id: string; version_seq: number }[]>`
      select tree_id, version_seq from organelle.trees where kind = 'published'
    `;
    if (published.length !== 1) return;
    const actor = "00000000-0000-4000-8000-000000000001";
    const treeId = crypto.randomUUID();
    const globalAuth = crypto.randomUUID();
    const draftAuth = crypto.randomUUID();
    const email = `collide-${globalAuth.slice(0, 8)}@example.com`;

    await sql!`
      insert into organelle.trees
        (tree_id, kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
      values (
        ${treeId}, 'sandbox', 'email-clash', ${actor}, ${actor},
        ${published[0]!.tree_id}, ${published[0]!.version_seq}
      )
    `;
    await sql!`
      insert into organelle.employees (auth_id, email, full_name, status)
      values (${globalAuth}, ${email}, 'Taken', 'active')
    `;
    await expect(
      sql!`
        insert into organelle.employees (
          auth_id, email, full_name, status, sandbox_tree_id
        ) values (
          ${draftAuth}, ${email}, 'Draft Clash', 'active', ${treeId}
        )
      `,
    ).rejects.toThrow();

    await sql!`delete from organelle.employees where auth_id = ${globalAuth}`;
    await sql!`delete from organelle.trees where tree_id = ${treeId}`;
  });
});
