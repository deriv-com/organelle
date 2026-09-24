# Development

Use Node.js 24, npm, Docker Compose v2, and PostgreSQL 17. Copy `.env.example` to
`.env`, choose local-only secrets, then run:

```bash
npm ci
docker compose up -d db
npm run db:migrate
npm run db:seed:demo
npm run dev
```

Generate `AUTH_SECRET` with `openssl rand -base64 32` and paste the result into `.env`.
The Compose application binds to loopback through `APP_BIND_ADDRESS=127.0.0.1` by
default.

The database CLI commands load `.env` automatically. Explicit environment variables
still take precedence, which is useful for disposable test databases and CI.

`AUTH_DEV_EMAIL=admin@example.com` provides development-only authentication. Remove it
when exercising OIDC. Never use it with a production process.

## Inspect the local database with pgAdmin

You can run pgAdmin locally without adding it to the application stack. The following
command binds it only to the loopback interface and stores its configuration in a named
volume:

```bash
docker run -d \
  --name organelle-pgadmin \
  -p 127.0.0.1:5050:80 \
  -e PGADMIN_DEFAULT_EMAIL=admin@example.com \
  -e PGADMIN_DEFAULT_PASSWORD=organelle_pgadmin_local \
  -v organelle_pgadmin:/var/lib/pgadmin \
  dpage/pgadmin4
```

With Podman, replace `docker` with `podman`. Open <http://localhost:5050> and sign in
with `admin@example.com` and `organelle_pgadmin_local`. These credentials protect the
pgAdmin interface; they are separate from the PostgreSQL credentials.

Choose **Add New Server**, name it `Organelle`, and enter:

| Setting  | Docker Desktop          | Podman                     | Native pgAdmin          |
| -------- | ----------------------- | -------------------------- | ----------------------- |
| Host     | `host.docker.internal`  | `host.containers.internal` | `127.0.0.1`             |
| Port     | `5432`                  | `5432`                     | `5432`                  |
| Database | `organelle`             | `organelle`                | `organelle`             |
| Username | `organelle_admin`       | `organelle_admin`          | `organelle_admin`       |
| Password | `organelle_admin_local` | `organelle_admin_local`    | `organelle_admin_local` |

If `POSTGRES_PORT` or the local database credentials differ in `.env`, use those values
instead. After saving the server, tables are under **Databases → organelle → Schemas →
organelle → Tables**. Restart an existing pgAdmin container with
`docker start organelle-pgadmin` (or `podman start organelle-pgadmin`). Do not expose
pgAdmin or PostgreSQL publicly, and do not use these development credentials in
production.

Run the normal gate with `make check`. Database suites require a migrated, disposable
PostgreSQL database:

```bash
createdb organelle_test
DATABASE_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:5432/organelle_test npm run db:migrate
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/organelle_test npm test
```

Also run `npm run build`, `npm audit --omit=dev --audit-level=high`, and
`docker compose config` before a pull request that affects packaging. Formatting uses
Prettier; linting uses ESLint; tests use Vitest. Migration files are immutable after
release because the runner rejects checksum changes. Add a numbered migration for every
subsequent schema change.

Before the first public release, `0001_baseline.sql` is intentionally rewritten instead.
After a baseline change, run `docker compose down -v` and repeat setup; this deletes all
local application data. Do not use that reset procedure after the first release.

Use only synthetic fixtures. Do not commit `.env`, database dumps, exports, production
URLs, real identities, or credentials. All commits require DCO sign-off.
