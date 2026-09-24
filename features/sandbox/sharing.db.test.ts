import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { sandboxAccessWithSql } from "./access";

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_URL ? describe : describe.skip;
const sql = TEST_URL ? postgres(TEST_URL, { max: 2, prepare: false }) : null;

const ownerId = "00000000-0000-4000-8000-000000009801";
const viewerId = "00000000-0000-4000-8000-000000009802";
let sandboxId: string;
let baseTreeId: string;

describeDb("sandbox sharing", () => {
  beforeAll(async () => {
    await sql!`
      insert into organelle.employees (auth_id, email, full_name, status)
      values
        (${ownerId}::uuid, 'sharing-owner@example.com', 'Sharing Owner', 'active'),
        (${viewerId}::uuid, 'sharing-viewer@example.com', 'Sharing Viewer', 'active')
      on conflict (auth_id) do nothing
    `;
    const base = await sql!<{ tree_id: string }[]>`
      insert into organelle.trees (kind, version_seq, created_by_auth_id)
      values ('historical', 998001, ${ownerId}::uuid)
      returning tree_id
    `;
    baseTreeId = base[0]!.tree_id;
    const rows = await sql!<{ tree_id: string }[]>`
      insert into organelle.trees
        (kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
      values (
        'sandbox', 'sharing-test', ${ownerId}::uuid, ${ownerId}::uuid,
        ${baseTreeId}, 998001
      )
      returning tree_id
    `;
    sandboxId = rows[0]!.tree_id;
  });

  afterAll(async () => {
    if (!sql) return;
    if (sandboxId) {
      await sql`delete from organelle.trees where tree_id = ${sandboxId}`;
    }
    if (baseTreeId) {
      await sql`delete from organelle.trees where tree_id = ${baseTreeId}`;
    }
    await sql`
      delete from organelle.employees
      where auth_id in (${ownerId}::uuid, ${viewerId}::uuid)
    `;
    await sql.end();
  });

  it("keeps a global Viewer read-only despite a legacy Editor grant", async () => {
    await sql!`
      insert into organelle.sandbox_shares
        (sandbox_tree_id, recipient_auth_id, access_level, granted_by_auth_id)
      values (${sandboxId}, ${viewerId}::uuid, 'editor', ${ownerId}::uuid)
    `;
    const actor = {
      authId: viewerId,
      email: "sharing-viewer@example.com",
      name: "Sharing Viewer",
      role: "viewer" as const,
    };
    const granted = await sandboxAccessWithSql(sql!, sandboxId, actor);
    expect(granted).toMatchObject({
      canView: true,
      canEdit: false,
      canPublish: false,
      canManageSharing: false,
    });

    await sql!`
      update organelle.sandbox_shares
      set expired_at = now(), expiry_reason = 'published'
      where sandbox_tree_id = ${sandboxId}
    `;
    const expired = await sandboxAccessWithSql(sql!, sandboxId, actor);
    expect(expired).toMatchObject({ canView: false, canEdit: false });
  });
});
