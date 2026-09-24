import postgres from "postgres";

import { pruneResignedEmptySeatsTx } from "../../features/employees/prune-resigned-seats.server";

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function organizationDate(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const actorEmail = arg("--actor-email")?.trim().toLowerCase();
const apply = process.argv.includes("--apply");
const timeZone = process.env.ORG_TIMEZONE?.trim() || "UTC";
const asOf = arg("--as-of")?.trim() || organizationDate(timeZone);
const url = process.env.DATABASE_ADMIN_URL?.trim();

if (!actorEmail) throw new Error("--actor-email <administrator> is required");
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("--as-of must use YYYY-MM-DD");
if (!url) throw new Error("DATABASE_ADMIN_URL is required");

type Transition = { auth_id: string; before_status: string; after_status: string };
type ReconcileResult = { transitions: number; pruned: number };
class DryRunRollback extends Error {
  constructor(readonly result: ReconcileResult) {
    super("dry_run_rollback");
  }
}
const sql = postgres(url, { max: 1 });
try {
  let result: ReconcileResult;
  try {
    result = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('organelle:employee-reconcile'))`;
      const actors = await tx<{ auth_id: string }[]>`
      select e.auth_id from organelle.employees e
      join organelle.app_roles r on r.auth_id = e.auth_id and r.role = 'admin'
      where lower(e.email) = ${actorEmail} and e.sandbox_tree_id is null
    `;
      if (actors.length !== 1) throw new Error("Actor must be an administrator");
      const transitions = await tx<Transition[]>`
      select auth_id, status::text as before_status,
             (case
               when last_working_date is not null and last_working_date < ${asOf}::date then 'resigned'
               when last_working_date is not null then 'serving_notice'
               when status = 'joining' and joining_date is not null and joining_date <= ${asOf}::date then 'active'
               else status::text
             end)::text as after_status
      from organelle.employees
      where status::text is distinct from (case
        when last_working_date is not null and last_working_date < ${asOf}::date then 'resigned'
        when last_working_date is not null then 'serving_notice'
        when status = 'joining' and joining_date is not null and joining_date <= ${asOf}::date then 'active'
        else status::text
      end)
      for update
    `;
      const published = await tx<{ tree_id: string }[]>`
      select tree_id from organelle.trees where kind = 'published'
    `;
      for (const row of transitions) {
        await tx`
        update organelle.employees
        set status = ${row.after_status}::organelle.employee_status,
            status_updated_at = now(), updated_at = now()
        where auth_id = ${row.auth_id}
      `;
        await tx`
        insert into organelle.change_log
          (tree_id, actor_auth_id, op, employee_auth_id, before, after)
        values (${published[0]!.tree_id}, ${actors[0]!.auth_id}, 'update_employee',
                ${row.auth_id}, ${tx.json({ status: row.before_status })},
                ${tx.json({ status: row.after_status })})
      `;
      }

      const trees = await tx<{ tree_id: string }[]>`
      select tree_id from organelle.trees
      where kind = 'published' or (kind = 'sandbox' and archived_at is null)
    `;
      let pruned = 0;
      for (const tree of trees) {
        pruned += await pruneResignedEmptySeatsTx(tx, tree.tree_id, actors[0]!.auth_id);
      }
      const result = { transitions: transitions.length, pruned };
      if (!apply) throw new DryRunRollback(result);
      return result;
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
    result = error.result;
  }
  console.log(
    `${apply ? "Applied" : "Dry run"}: ${result.transitions} status transition(s), ${result.pruned} seat(s) pruned as of ${asOf} (${timeZone})`,
  );
} finally {
  await sql.end();
}
