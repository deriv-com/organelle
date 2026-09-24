import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import postgres from "postgres";

const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required");

const migrationsDir = resolve(process.cwd(), "db/migrations");
const sql = postgres(adminUrl, { max: 1, prepare: false });

const checksum = (contents) => createHash("sha256").update(contents).digest("hex");

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("Invalid database role name");
  return `"${value}"`;
}

const quoteLiteral = (value) => `'${value.replaceAll("'", "''")}'`;

async function applyMigrations() {
  await sql`select pg_advisory_lock(hashtext('organelle:migrations'))`;
  try {
    await sql`create table if not exists public.organelle_schema_migrations (
      filename text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`;
    const files = (await readdir(migrationsDir))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort();
    for (const filename of files) {
      const contents = await readFile(resolve(migrationsDir, filename), "utf8");
      const digest = checksum(contents);
      const applied = await sql`
        select checksum from public.organelle_schema_migrations where filename = ${filename}`;
      if (applied[0]) {
        if (applied[0].checksum !== digest)
          throw new Error(`Applied migration ${filename} has changed`);
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(contents);
        await tx`insert into public.organelle_schema_migrations (filename, checksum)
          values (${filename}, ${digest})`;
      });
      console.log(`Applied ${filename}`);
    }
  } finally {
    await sql`select pg_advisory_unlock(hashtext('organelle:migrations'))`;
  }
}

async function configureRuntimeRole() {
  const role = process.env.DATABASE_APP_USER?.trim() || "organelle_app";
  const password = process.env.DATABASE_APP_PASSWORD;
  const roleSql = quoteIdentifier(role);
  const exists =
    await sql`select exists(select 1 from pg_roles where rolname = ${role}) as exists`;
  if (!exists[0]?.exists) await sql.unsafe(`create role ${roleSql} login`);
  if (password)
    await sql.unsafe(`alter role ${roleSql} password ${quoteLiteral(password)}`);
  await sql.unsafe(`grant usage on schema organelle to ${roleSql}`);
  await sql.unsafe(
    `grant select, insert, update, delete on all tables in schema organelle to ${roleSql}`,
  );
  await sql.unsafe(
    `grant usage, select on all sequences in schema organelle to ${roleSql}`,
  );
  await sql.unsafe(`grant execute on all functions in schema organelle to ${roleSql}`);
  await sql.unsafe(
    `alter default privileges in schema organelle grant select, insert, update, delete on tables to ${roleSql}`,
  );
  await sql.unsafe(
    `alter default privileges in schema organelle grant usage, select on sequences to ${roleSql}`,
  );
  await sql.unsafe(
    `alter default privileges in schema organelle grant execute on functions to ${roleSql}`,
  );
}

try {
  await applyMigrations();
  await configureRuntimeRole();
} finally {
  await sql.end();
}
