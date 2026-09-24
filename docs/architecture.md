# Architecture

Organelle is a Next.js application backed by one PostgreSQL 17 database. Browser
requests use server-rendered routes and server actions. Auth.js validates an OpenID
Connect identity and stores an encrypted, HTTP-only JWT session. A first sign-in binds a
verified directory email to the provider's issuer/subject pair; later requests resolve
that stable binding and load the employee's current application role.

Human traffic and machine traffic have separate authentication boundaries.
`/api/integrations/v1/**` accepts only hashed, scoped bearer API keys. Other protected
routes require a human session. The reverse proxy terminates TLS; PostgreSQL is not
exposed publicly.

The published tree is immutable history: changes are prepared in a sandbox, stored as
commands and current tree state, reviewed, and transactionally merged into a new
published version. Optimistic row versions and database validation guard concurrent or
invalid changes. Audit entries record actor, operation, target, and before/after
metadata. Application logs are operational JSON or text events with tested secret and
PII redaction and single-line text messages; they are not an audit substitute.

Containers have distinct duties: `db` persists PostgreSQL data, `migrate` applies
checksum-protected migrations under an advisory lock using an administrative connection,
`app` uses a least-privileged runtime login, and the optional `caddy` profile provides
HTTPS. One deployment represents one organization; multi-tenancy is deliberately out of
scope.
