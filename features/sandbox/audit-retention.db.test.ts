import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_URL ? describe : describe.skip;
const sql = TEST_URL ? postgres(TEST_URL, { max: 1, prepare: false }) : null;

const ownerId = "00000000-0000-4000-8000-000000009850";
let baseTreeId: string;
let sandboxId: string;
let auditId: string;

describeDb("sandbox audit retention", () => {
  beforeAll(async () => {
    await sql!`
      insert into organelle.employees (auth_id, email, full_name, status)
      values (${ownerId}::uuid, 'audit-owner@example.com', 'Audit Owner', 'active')
      on conflict (auth_id) do nothing
    `;
    const base = await sql!<{ tree_id: string }[]>`
      insert into organelle.trees (kind, version_seq, created_by_auth_id)
      values ('historical', 998050, ${ownerId}::uuid)
      returning tree_id
    `;
    baseTreeId = base[0]!.tree_id;
    const sandbox = await sql!<{ tree_id: string }[]>`
      insert into organelle.trees
        (kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
      values (
        'sandbox', 'audit-retention-test', ${ownerId}::uuid, ${ownerId}::uuid,
        ${baseTreeId}, 998050
      )
      returning tree_id
    `;
    sandboxId = sandbox[0]!.tree_id;
    const audit = await sql!<{ id: string }[]>`
      insert into organelle.change_log
        (tree_id, actor_auth_id, op, before, after)
      values (
        ${sandboxId}, ${ownerId}::uuid, 'fork_sandbox',
        '{"source":"published"}'::jsonb,
        '{"result":"sandbox"}'::jsonb
      )
      returning id::text as id
    `;
    auditId = audit[0]!.id;
  });

  afterAll(async () => {
    if (!sql) return;
    if (auditId) await sql`delete from organelle.change_log where id = ${auditId}`;
    if (sandboxId) await sql`delete from organelle.trees where tree_id = ${sandboxId}`;
    if (baseTreeId)
      await sql`delete from organelle.trees where tree_id = ${baseTreeId}`;
    await sql`delete from organelle.employees where auth_id = ${ownerId}::uuid`;
    await sql.end();
  });

  it("keeps the audit event after its sandbox is deleted", async () => {
    await sql!`delete from organelle.trees where tree_id = ${sandboxId}`;

    const rows = await sql!<
      {
        tree_id: string | null;
        actor_auth_id: string;
        before: unknown;
        after: unknown;
      }[]
    >`
      select tree_id, actor_auth_id::text, before, after
      from organelle.change_log
      where id = ${auditId}
    `;
    expect(rows).toEqual([
      {
        tree_id: null,
        actor_auth_id: ownerId,
        before: { source: "published" },
        after: { result: "sandbox" },
      },
    ]);
  });
});
