import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

/**
 * Serving Notice database invariants.
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *   npx vitest run features/employees/serving-notice-constraint.db.test.ts
 */

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_URL ? describe : describe.skip;
const sql = TEST_URL ? postgres(TEST_URL, { max: 1, prepare: false }) : null;

describeDb("serving notice Last working date constraints", () => {
  beforeAll(async () => {
    await sql!`select 1`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("installs both validated constraint directions on employees and overrides", async () => {
    const constraints = await sql!<
      {
        table_name: string;
        constraint_name: string;
        validated: boolean;
        definition: string;
      }[]
    >`
      select n.nspname || '.' || t.relname as table_name,
             c.conname as constraint_name,
             c.convalidated as validated,
             pg_get_constraintdef(c.oid) as definition
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where c.conname in (
        'employees_serving_notice_requires_last_working_date',
        'employee_overrides_serving_notice_requires_last_working_date',
        'employees_last_working_date_requires_exit_status',
        'employee_overrides_last_working_date_requires_exit_status'
      )
      order by c.conname
    `;

    const byName = new Map(constraints.map((row) => [row.constraint_name, row]));
    const expected = [
      {
        name: "employees_serving_notice_requires_last_working_date",
        table: "organelle.employees",
        fragments: ["last_working_date IS NOT NULL", "serving_notice"],
      },
      {
        name: "employee_overrides_serving_notice_requires_last_working_date",
        table: "organelle.employee_overrides",
        fragments: ["last_working_date IS NOT NULL", "serving_notice"],
      },
      {
        name: "employees_last_working_date_requires_exit_status",
        table: "organelle.employees",
        fragments: ["last_working_date IS NULL", "serving_notice", "resigned"],
      },
      {
        name: "employee_overrides_last_working_date_requires_exit_status",
        table: "organelle.employee_overrides",
        fragments: ["last_working_date IS NULL", "serving_notice", "resigned"],
      },
    ];

    expect(constraints).toHaveLength(expected.length);
    for (const item of expected) {
      const constraint = byName.get(item.name);
      expect(constraint).toMatchObject({ table_name: item.table, validated: true });
      for (const fragment of item.fragments) {
        expect(constraint?.definition).toContain(fragment);
      }
    }
  });

  it("accepts and rejects status/LWD writes in both tables", async () => {
    const actor = crypto.randomUUID();
    const employee = crypto.randomUUID();
    const baseTree = crypto.randomUUID();
    const tree = crypto.randomUUID();
    const node = crypto.randomUUID();
    const versionSeq =
      -Number.parseInt(baseTree.replaceAll("-", "").slice(0, 12), 16) - 1;

    try {
      await sql!`
        insert into organelle.trees (
          tree_id, kind, version_seq, created_by_auth_id
        ) values (${baseTree}, 'historical', ${versionSeq}, ${actor})
      `;
      await sql!`
        insert into organelle.trees (
          tree_id, kind, name, owner_auth_id, created_by_auth_id,
          forked_from_tree_id, forked_from_seq
        ) values (
          ${tree}, 'sandbox', 'Serving notice constraint test', ${actor}, ${actor},
          ${baseTree}, ${versionSeq}
        )
      `;
      await sql!`
        insert into organelle.nodes (
          tree_id, node_id, parent_node_id, node_type, sort_order, name, job_title
        ) values (${tree}, ${node}, null, 'seat', 0, null, 'Test seat')
      `;
      await sql!`
        insert into organelle.employees (
          auth_id, email, full_name, status
        ) values (
          ${employee}, ${`constraint-${employee}@example.com`}, 'Constraint Person', 'active'
        )
      `;
      await sql!`
        insert into organelle.employee_overrides (
          tree_id, node_id, auth_id, status, last_working_date, updated_by
        ) values (${tree}, ${node}, ${employee}, 'active', null, ${actor})
      `;

      await expect(sql!`
        update organelle.employees
        set status = 'serving_notice', last_working_date = null
        where auth_id = ${employee}
      `).rejects.toThrow(/employees_serving_notice_requires_last_working_date/);
      await expect(sql!`
        update organelle.employees
        set status = 'active', last_working_date = '2099-12-31'
        where auth_id = ${employee}
      `).rejects.toThrow(/employees_last_working_date_requires_exit_status/);
      await sql!`
        update organelle.employees
        set status = 'serving_notice', last_working_date = '2099-12-31'
        where auth_id = ${employee}
      `;
      await sql!`
        update organelle.employees
        set status = 'resigned', last_working_date = '2000-01-01'
        where auth_id = ${employee}
      `;

      await expect(sql!`
        update organelle.employee_overrides
        set status = 'serving_notice', last_working_date = null
        where tree_id = ${tree} and auth_id = ${employee}
      `).rejects.toThrow(
        /employee_overrides_serving_notice_requires_last_working_date/,
      );
      await expect(sql!`
        update organelle.employee_overrides
        set status = 'active', last_working_date = '2099-12-31'
        where tree_id = ${tree} and auth_id = ${employee}
      `).rejects.toThrow(/employee_overrides_last_working_date_requires_exit_status/);
      await sql!`
        update organelle.employee_overrides
        set status = 'serving_notice', last_working_date = '2099-12-31'
        where tree_id = ${tree} and auth_id = ${employee}
      `;
      await sql!`
        update organelle.employee_overrides
        set status = 'resigned', last_working_date = '2000-01-01'
        where tree_id = ${tree} and auth_id = ${employee}
      `;

      const saved = await sql!<
        { source: string; status: string; last_working_date: string }[]
      >`
        select 'employee' as source, status::text, last_working_date::text
        from organelle.employees
        where auth_id = ${employee}
        union all
        select 'override' as source, status::text, last_working_date::text
        from organelle.employee_overrides
        where tree_id = ${tree} and auth_id = ${employee}
        order by source
      `;
      expect(saved).toEqual([
        { source: "employee", status: "resigned", last_working_date: "2000-01-01" },
        { source: "override", status: "resigned", last_working_date: "2000-01-01" },
      ]);
    } finally {
      await sql!`delete from organelle.trees where tree_id = ${tree}`;
      await sql!`delete from organelle.trees where tree_id = ${baseTree}`;
      await sql!`delete from organelle.employees where auth_id = ${employee}`;
    }
  });
});
