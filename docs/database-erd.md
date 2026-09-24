# Database entity-relationship diagrams

Organelle stores application data in the PostgreSQL `organelle` schema. The diagrams
below are views of the same schema, split by domain so that they remain readable on
GitHub and in rendered documentation.

The authoritative schema is
[`db/migrations/0001_baseline.sql`](../db/migrations/0001_baseline.sql). Update these
diagrams whenever that baseline changes. The migration runner's
`public.organelle_schema_migrations` table is operational metadata and is not included
in the application ERDs.

## Legend

- `PK` — primary key; columns can be part of a composite primary key.
- `FK` — declared PostgreSQL foreign key; columns can be part of a composite foreign
  key.
- `UK` — unique key.
- `||` means exactly one, `o|` means zero or one, and `o{` means zero or many.
- A nullable column is marked `nullable` in its comment where that detail is important
  to the relationship.
- JSON fields contain reviewed workflow snapshots or audit payloads; they do not create
  additional database relationships.

## Directory, identity, and access

`employees.auth_id` is the stable internal identity used throughout the application.
OIDC issuer and subject establish the login identity after the first verified-email
binding. Application roles are separate from sandbox-specific access grants.

```mermaid
erDiagram
    EMPLOYEES {
        uuid auth_id PK
        varchar id
        varchar employment_record
        varchar email UK
        varchar full_name
        varchar legal_full_name
        varchar job_title
        smallint position_level
        varchar avatar_url
        varchar office_country
        varchar office_location
        varchar hiring_company
        employee_status status
        date joining_date
        date hired_at
        date resignation_date
        date last_working_date
        timestamptz updated_at
        uuid primary_manager_auth_id
        varchar primary_team_path
        uuid sandbox_tree_id FK "nullable; draft scope"
        timestamptz status_updated_at
    }

    OIDC_IDENTITIES {
        uuid employee_auth_id PK, FK
        text issuer UK
        text subject UK
        timestamptz bound_at
    }

    APP_ROLES {
        uuid auth_id PK, FK
        app_role role
        uuid granted_by "logical employee reference"
        timestamptz granted_at
    }

    API_KEYS {
        uuid id PK
        text label
        text key_prefix UK
        text key_hash
        text_array scopes
        uuid created_by FK
        timestamptz created_at
        timestamptz expires_at
        timestamptz revoked_at "nullable"
    }

    TREES {
        uuid tree_id PK
        tree_kind kind
        bigint version_seq UK "nullable for sandboxes"
        uuid forked_from_tree_id FK "nullable"
        bigint forked_from_seq "nullable"
        text name "sandbox name"
        uuid owner_auth_id "logical employee reference"
        uuid created_by_auth_id "logical employee reference"
        timestamptz created_at
        timestamptz published_at "nullable"
        timestamptz archived_at "nullable"
    }

    EMPLOYEES ||--o| OIDC_IDENTITIES : "has login binding"
    EMPLOYEES ||--o| APP_ROLES : "has application role"
    EMPLOYEES ||--o{ API_KEYS : "creates"
    TREES o|--o{ EMPLOYEES : "scopes draft employees"
```

The unique OIDC key is the pair `(issuer, subject)`, and each employee can have at most
one binding. Employee email is also unique case-insensitively when present; the `UK`
marker is a compact representation of that partial expression index. `key_prefix` is
unique, while only the API-key hash—not the secret—is stored.

## Organization structures and sandbox edits

A tree is one published version, historical version, or sandbox. Node and assignment
keys include `tree_id`, keeping every structure isolated. Employee overrides and edit
snapshots stage profile changes until a reviewed sandbox merge.

```mermaid
erDiagram
    TREES {
        uuid tree_id PK
        tree_kind kind
        bigint version_seq UK "nullable for sandboxes"
        uuid forked_from_tree_id FK "nullable"
        bigint forked_from_seq "nullable"
        text name "nullable"
        uuid owner_auth_id "logical employee reference"
        uuid created_by_auth_id "logical employee reference"
        timestamptz created_at
        timestamptz published_at "nullable"
        timestamptz archived_at "nullable"
    }

    NODES {
        uuid tree_id PK, FK
        uuid node_id PK
        uuid parent_node_id FK "nullable for root"
        node_type node_type
        integer sort_order
        varchar name "headers only"
        varchar job_title
        smallint position_level
        timestamptz created_at
        timestamptz updated_at
        bigint row_version
        ltree path
        boolean is_assistant
        smallint leaf_grid_columns
    }

    SEAT_ASSIGNMENTS {
        uuid tree_id PK, FK
        uuid node_id PK, FK
        uuid employee_auth_id PK, FK
        boolean is_host
        timestamptz assigned_at
        boolean is_primary
    }

    EMPLOYEES {
        uuid auth_id PK
        varchar email UK
        varchar full_name
        employee_status status
        uuid sandbox_tree_id FK "nullable"
    }

    EMPLOYEE_OVERRIDES {
        uuid tree_id PK, FK
        uuid node_id FK
        uuid auth_id PK, FK
        varchar display_name
        varchar display_title
        varchar avatar_url
        varchar legal_full_name
        varchar office_country
        varchar office_location
        varchar hiring_company
        employee_status status
        date joining_date
        date hired_at
        date resignation_date
        date last_working_date
        varchar external_id
        varchar employment_record
        smallint position_level
        uuid primary_manager_auth_id
        varchar primary_team_path
        uuid updated_by "logical employee reference"
        timestamptz updated_at
    }

    SANDBOX_EMPLOYEE_EDITS {
        uuid tree_id PK, FK
        uuid employee_auth_id PK, FK
        jsonb before_data
        jsonb after_data
    }

    TREES o|--o{ TREES : "is fork origin for"
    TREES ||--o{ NODES : contains
    NODES o|--o{ NODES : "parent of"
    NODES ||--o{ SEAT_ASSIGNMENTS : "receives assignments"
    EMPLOYEES ||--o{ SEAT_ASSIGNMENTS : "occupies seats"
    NODES ||--o{ EMPLOYEE_OVERRIDES : "anchors staged profile"
    EMPLOYEES ||--o{ EMPLOYEE_OVERRIDES : "has staged profile"
    TREES ||--o{ SANDBOX_EMPLOYEE_EDITS : "records edit snapshots"
    EMPLOYEES ||--o{ SANDBOX_EMPLOYEE_EDITS : "is edited in"
    TREES o|--o{ EMPLOYEES : "scopes draft employees"
```

Important structural constraints not expressible as simple ERD links include one root
per tree, one host per seat, one primary seat per employee per tree, and one assistant
per parent. `organelle.validate_tree` performs additional whole-tree validation.

## Sandbox collaboration, publication, and audit

Shares grant viewer or editor access to a sandbox. Merge and synchronization records
store the exact reviewed resolutions and snapshot applied by the database functions. The
change log is the append-oriented audit and undo/redo record.

```mermaid
erDiagram
    TREES {
        uuid tree_id PK
        tree_kind kind
        bigint version_seq UK "nullable"
        uuid forked_from_tree_id FK "nullable"
        uuid owner_auth_id "logical employee reference"
    }

    EMPLOYEES {
        uuid auth_id PK
        varchar email UK
        varchar full_name
    }

    SANDBOX_SHARES {
        uuid share_id PK
        uuid sandbox_tree_id FK
        uuid recipient_auth_id FK
        sandbox_access_level access_level
        uuid granted_by_auth_id FK
        timestamptz granted_at
        timestamptz revoked_at "nullable"
        uuid revoked_by_auth_id FK "nullable"
        timestamptz expired_at "nullable"
        text expiry_reason "nullable"
    }

    SANDBOX_MERGES {
        uuid merge_id PK
        uuid sandbox_tree_id FK "nullable after re-fork"
        bigint forked_from_seq
        bigint target_seq
        uuid resulting_tree_id FK "nullable until merged"
        uuid merger_auth_id "logical employee reference"
        merge_status status
        text title "nullable"
        jsonb resolutions
        jsonb included_keys "nullable"
        jsonb counts "nullable"
        text failure_reason "nullable"
        timestamptz created_at
        timestamptz merged_at "nullable"
        jsonb snapshot
        change_type publish_change_type "nullable"
        jsonb change_reason_overrides "nullable"
    }

    SANDBOX_SYNCS {
        uuid sync_id PK
        uuid sandbox_tree_id FK
        bigint forked_from_seq
        bigint target_seq
        uuid actor_auth_id "logical employee reference"
        merge_status status
        jsonb resolutions
        jsonb counts "nullable"
        jsonb snapshot
        text failure_reason "nullable"
        timestamptz created_at
        timestamptz merged_at "nullable"
    }

    CHANGE_LOG {
        bigint id PK
        uuid tree_id FK "nullable after tree deletion"
        uuid actor_auth_id "logical employee reference"
        change_op op
        uuid node_id "logical node reference"
        uuid employee_auth_id "logical employee reference"
        jsonb before "nullable"
        jsonb after "nullable"
        uuid merge_id "logical merge reference"
        timestamptz created_at
        uuid command_id "nullable"
        command_kind command_kind "nullable"
        uuid undoes_command_id "nullable"
    }

    TREES ||--o{ SANDBOX_SHARES : "is shared through"
    EMPLOYEES ||--o{ SANDBOX_SHARES : "receives share"
    EMPLOYEES ||--o{ SANDBOX_SHARES : "grants share"
    EMPLOYEES o|--o{ SANDBOX_SHARES : "revokes share"
    TREES o|--o{ SANDBOX_MERGES : "is merge source"
    TREES o|--o{ SANDBOX_MERGES : "is merge result"
    TREES ||--o{ SANDBOX_SYNCS : "is synchronized"
    TREES ||--o{ CHANGE_LOG : "has audit events"
```

### Logical references

Several actor and audit columns intentionally do not have foreign keys. This preserves
workflow and audit history and avoids coupling every historical event to the lifecycle
of an employee, node, command, or merge row. These include:

- `app_roles.granted_by`
- `trees.owner_auth_id` and `trees.created_by_auth_id`
- `employee_overrides.updated_by`
- `sandbox_merges.merger_auth_id`
- `sandbox_syncs.actor_auth_id`
- `change_log.actor_auth_id`, `node_id`, `employee_auth_id`, `merge_id`, `command_id`,
  and `undoes_command_id`

`employees.primary_manager_auth_id` and `employee_overrides.primary_manager_auth_id` are
also denormalized identity references, not declared foreign keys.

## Deletion behavior

- Deleting a tree preserves its audit entries and sets their `tree_id` to null. It
  cascades to nodes, sandbox edit snapshots, shares, and synchronization records. Nodes
  cascade to seat assignments and employee overrides.
- A node with children cannot be deleted until those children have been moved or deleted
  because the self-referencing parent foreign key uses `ON DELETE RESTRICT`.
- Deleting an employee cascades to its OIDC binding, role, assignments, staged
  overrides, sandbox edit snapshots, and shares received by that employee.
- A merge keeps its provenance when its original sandbox is removed: the
  `sandbox_tree_id` becomes null. Its resulting published tree uses the default
  restrictive behavior.
- A tree referenced as another tree's fork origin cannot be deleted while that reference
  exists.
- Foreign keys without an explicit action use PostgreSQL's default `NO ACTION` behavior.
  In particular, API-key creators and share grant/revoke actors must remain while those
  rows reference them.

## Keeping the ERD current

Before merging a schema change:

1. Update `db/migrations/0001_baseline.sql` (before the first public release) or add the
   appropriate forward migration (after releases begin).
2. Update the affected diagram and relationship notes on this page.
3. Recreate or migrate a test database and run the PostgreSQL-backed test suite.
