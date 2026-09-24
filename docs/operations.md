# Production operations

## Configuration and first deployment

Copy `.env.example` to a protected deployment environment, generate independent
high-entropy database, OIDC, and session secrets, and use a versioned image digest or
tag. Set `APP_HOSTNAME`, `APP_BASE_URL`, `ORG_NAME`, and an IANA `ORG_TIMEZONE`. Keep
the administrative database URL available only to the one-shot migration job; the
application receives only `DATABASE_URL` for `organelle_app`.

Set a generated `AUTH_SECRET`; production startup rejects missing, short, and known
placeholder values. The development Compose file binds to loopback unless
`APP_BIND_ADDRESS` is explicitly changed.

Use `deploy/compose.production.yml` from the `deploy` directory. Start with HTTPS:

```bash
docker compose -f compose.production.yml --profile https pull
docker compose -f compose.production.yml --profile https up -d
docker compose -f compose.production.yml ps
```

DNS must resolve the hostname to the server and ports 80/443 must be reachable for
automatic certificates. For an existing load balancer, omit the HTTPS profile, bind the
application only to a private interface, forward the original host/protocol, and enforce
TLS there. Never expose PostgreSQL publicly.

## Backups and restore drills

Take encrypted, access-controlled PostgreSQL logical backups on a schedule appropriate
to the organization's recovery objectives:

```bash
pg_dump --format=custom --no-owner --dbname "$DATABASE_ADMIN_URL" --file organelle.dump
createdb organelle_restore_test
pg_restore --clean --if-exists --no-owner --dbname "$RESTORE_TEST_URL" organelle.dump
```

Regularly restore into an isolated PostgreSQL 17 instance, run migrations, check
`/api/health`, sign in, and verify chart, audit, sandbox, and export behavior. A backup
is not proven until a restore drill succeeds. Protect dumps as sensitive workforce data
and define retention and deletion policies.

## Upgrades and rollback

Read the changelog, back up and test restore, pull the exact new version, run its
migration job, then replace the app. Migration checksums detect altered history and an
advisory lock prevents concurrent runners. Do not start an older application after a
forward-only schema migration unless that release's notes explicitly declare
compatibility. Rollback normally means restoring the pre-upgrade database backup and
previous image together during a maintenance window.

## Employee lifecycle maintenance

Chart and directory reads never modify database state. Schedule the following command at
least daily after the organization's local midnight:

```bash
npm run employees:reconcile -- --actor-email administrator@example.com --apply
```

The command uses `ORG_TIMEZONE`, `DATABASE_ADMIN_URL`, an advisory lock, and one
transaction. Omit `--apply` for a rollback-only dry run, or supply `--as-of YYYY-MM-DD`
for a controlled recovery run. It updates lifecycle statuses and prunes eligible seats
from the published chart and active sandboxes without changing historical versions.

## Recovery and troubleshooting

- If migration fails, leave the app stopped, inspect the migration logs, correct
  connectivity or permissions, and rerun. Never edit an already-applied migration.
- If the application reports database failures, verify `pg_isready`, storage capacity,
  runtime-role login, TLS settings, and that migrations completed.
- For OIDC loops, verify the exact external `APP_BASE_URL`, callback URI, issuer
  discovery document, client secret, proxy host/protocol headers, and server clock.
- For denied users, confirm normalized email, directory membership, optional domain
  filter, active provider assignment, and application role.
- For certificate failures, verify public DNS, firewall rules, and proxy persistent
  storage.
- Logs default to structured JSON. Keep access restricted; redaction is defense in
  depth, not permission to log workforce records or secrets.

If the database is damaged, stop writers, preserve the failed volume for investigation,
provision a clean PostgreSQL 17 instance, restore the latest verified backup, run the
current migration image, validate health and record counts, then reopen traffic.
Document recovery time and any data gap.
