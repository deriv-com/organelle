import postgres from "postgres";

const emailFlag = process.argv.indexOf("--email");
const email =
  emailFlag >= 0 ? process.argv[emailFlag + 1]?.trim().toLowerCase() : undefined;
if (!email)
  throw new Error("Usage: npm run admin:bootstrap -- --email admin@example.com");

const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL is required");
const sql = postgres(url, { max: 1, prepare: false });

try {
  await sql.begin(async (tx) => {
    const employee = await tx<{ auth_id: string }[]>`
      select auth_id from organelle.employees
      where lower(email) = ${email} and sandbox_tree_id is null for update`;
    if (employee.length !== 1)
      throw new Error("The administrator email is not in the directory");

    const admins = await tx<{ auth_id: string }[]>`
      select auth_id from organelle.app_roles where role = 'admin' for update`;
    const authId = employee[0]!.auth_id;
    if (admins.length > 0 && !admins.some((row) => row.auth_id === authId)) {
      throw new Error("An administrator already exists; use the in-app role manager");
    }
    await tx`insert into organelle.app_roles (auth_id, role, granted_by)
      values (${authId}, 'admin', ${authId})
      on conflict (auth_id) do update set role = 'admin'`;
  });
  console.log(`Administrator ready: ${email}`);
} finally {
  await sql.end();
}
