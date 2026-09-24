import postgres from "postgres";

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const email = arg("--email")?.trim().toLowerCase();
const actorEmail = arg("--actor-email")?.trim().toLowerCase();
const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_ADMIN_URL?.trim();

if (!email || !actorEmail) {
  throw new Error("Usage: --email <target> --actor-email <administrator> [--apply]");
}
if (!url) throw new Error("DATABASE_ADMIN_URL is required");

const sql = postgres(url, { max: 1 });
try {
  const result = await sql.begin(async (tx) => {
    const actors = await tx<{ auth_id: string }[]>`
      select e.auth_id
      from organelle.employees e
      join organelle.app_roles r on r.auth_id = e.auth_id and r.role = 'admin'
      where lower(e.email) = ${actorEmail} and e.sandbox_tree_id is null
    `;
    if (actors.length !== 1) throw new Error("Actor must be an administrator");
    const targets = await tx<{ auth_id: string; bound: boolean }[]>`
      select e.auth_id, (i.employee_auth_id is not null) as bound
      from organelle.employees e
      left join organelle.oidc_identities i on i.employee_auth_id = e.auth_id
      where lower(e.email) = ${email} and e.sandbox_tree_id is null
      for update of e
    `;
    if (targets.length !== 1) throw new Error("Target employee was not found");
    if (!apply || !targets[0]!.bound) {
      return { bound: targets[0]!.bound, changed: false };
    }
    await tx`delete from organelle.oidc_identities where employee_auth_id = ${targets[0]!.auth_id}`;
    await tx`
      insert into organelle.change_log
        (tree_id, actor_auth_id, op, employee_auth_id, before, after)
      select tree_id, ${actors[0]!.auth_id}, 'reset_oidc_identity',
             ${targets[0]!.auth_id}, '{"bound":true}'::jsonb, '{"bound":false}'::jsonb
      from organelle.trees where kind = 'published'
    `;
    return { bound: true, changed: true };
  });
  console.log(
    apply
      ? result.changed
        ? `Reset OIDC identity for ${email}`
        : `${email} has no OIDC identity to reset`
      : `Dry run: ${email} is ${result.bound ? "bound" : "not bound"}; pass --apply to reset`,
  );
} finally {
  await sql.end();
}
