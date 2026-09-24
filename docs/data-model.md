# Data model

See the [database entity-relationship diagrams](database-erd.md) for table columns,
declared foreign keys, logical audit references, and deletion behavior.

All application objects live in the `organelle` schema.
`public.organelle_schema_migrations` records migration filename, SHA-256 checksum, and
application time.

- `employees` is the directory identity record. Published employees have no
  `sandbox_tree_id`; sandbox-only draft employees are isolated to one sandbox.
- `app_roles` maps employee authentication IDs to `viewer`, `developer`, `editor`,
  `publisher`, or `admin`.
- `oidc_identities` binds one employee to one unique OpenID Connect issuer/subject pair;
  email is used only for the initial trusted match.
- `trees` identifies published versions and sandboxes. Sandboxes retain a base published
  tree for merge comparison.
- `nodes` contains headers and seats with a parent relationship and deterministic
  ordering.
- `seat_assignments` links employees to seats and records host and primary assignments.
- `employee_overrides` stores chart-specific profile overrides without carrying the
  employee's login email.
- `sandbox_shares` provides sandbox collaboration; command identifiers in `change_log`
  support undo and redo.
- `sandbox_merges` and `sandbox_syncs` capture reviewed resolutions and the exact
  snapshots applied by publication and synchronization workflows.
- `change_log` is the append-oriented application audit trail. Its nullable tree
  reference preserves events after a sandbox is deleted.
- `api_keys` stores only key hashes, prefixes, scopes, expiry, and lifecycle metadata.

Foreign keys, uniqueness constraints, triggers, and `organelle.validate_tree` enforce
structural integrity. Published version 1 is created by the initial import. Later
publications create additional immutable versions. The schema is a clean baseline and is
not intended to import databases from any earlier private deployment.
