# Authentication and authorization

## OpenID Connect

Register a confidential web application with any standards-compliant OpenID Connect
provider. Set the callback URI to:

```text
https://organelle.example.com/api/auth/callback/oidc
```

Configure `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `AUTH_SECRET`, and
`APP_BASE_URL`. The issuer must publish OpenID discovery metadata. Organelle requests
`openid email profile` and rejects identities unless `email_verified` is exactly `true`.
`AUTH_SECRET` must be a non-placeholder value of at least 32 characters and must be
shared by all application replicas.

On first sign-in, Organelle normalizes the email, checks `ALLOWED_EMAIL_DOMAINS`, and
binds exactly one matching unbound directory employee to the provider's stable
`(issuer, subject)` pair. Later sessions resolve through that binding rather than email,
while roles are always loaded from the database. An unknown, conflicting, or already
bound identity is denied. Empty `ALLOWED_EMAIL_DOMAINS` permits any domain while
directory membership remains mandatory.

Email is an administrator-controlled identity attribute and is never changed by a
sandbox merge. If a provider subject must be replaced, a database administrator can
inspect and then apply a reset:

```bash
npm run admin:identity:reset -- --email person@example.com --actor-email administrator@example.com
npm run admin:identity:reset -- --email person@example.com --actor-email administrator@example.com --apply
```

`AUTH_DEV_EMAIL` bypasses OIDC only when `NODE_ENV=development`. A production process
never honors it.

## Roles

| Role      | Capabilities                                                                          |
| --------- | ------------------------------------------------------------------------------------- |
| Viewer    | Read the published chart and directory; use explicitly shared sandbox access          |
| Developer | Read-only developer designation; machine credentials remain admin-managed             |
| Editor    | Create and edit owned sandboxes and manage their shares                               |
| Publisher | Editor capabilities plus merge, export, directory status changes, and version restore |
| Admin     | All capabilities plus role management, API keys, and organization-wide sandbox access |

Sandbox shares cannot elevate an account beyond its organization-wide role. Viewers and
developers can receive read-only shares. Editor access can be assigned only to an
Editor, Publisher, or Admin; shared Publishers and Admins receive effective Editor
access automatically.

Admins cannot remove the final administrator. Bootstrap creates only the first admin;
subsequent changes use the in-app role manager. Use least privilege and periodically
review roles, shares, provider access, and API keys.
