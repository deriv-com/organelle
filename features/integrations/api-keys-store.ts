/**
 * API key store. Service-role SQL via withDbRetry.
 */

import { withDbRetry } from "@/lib/db";
import { API_KEY_LABEL_MAX_LEN } from "./api-key-label";
import { generateApiKey } from "./api-key-crypto";
import { parseScopes, type IntegrationScope } from "./scopes";

export type ApiKeyRow = {
  id: string;
  label: string;
  keyPrefix: string;
  scopes: string[];
  createdBy: string;
  createdByName: string | null;
  createdByEmail: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type ApiKeyAuthRecord = {
  id: string;
  label: string;
  keyHash: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
};

type DbApiKeyListRow = {
  id: string;
  label: string;
  key_prefix: string;
  scopes: string[];
  created_by: string;
  created_by_name: string | null;
  created_by_email: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};

type DbApiKeyRow = {
  id: string;
  label: string;
  key_prefix: string;
  key_hash: string;
  scopes: string[];
  created_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};

function mapListRow(row: DbApiKeyListRow): ApiKeyRow {
  return {
    id: row.id,
    label: row.label,
    keyPrefix: row.key_prefix,
    scopes: row.scopes,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

function mapCreatedRow(row: DbApiKeyRow): ApiKeyRow {
  return {
    id: row.id,
    label: row.label,
    keyPrefix: row.key_prefix,
    scopes: row.scopes,
    createdBy: row.created_by,
    createdByName: null,
    createdByEmail: null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export type ListApiKeysOpts = {
  /** When set, only keys created by this auth_id. */
  createdBy?: string;
};

export async function listApiKeys(opts: ListApiKeysOpts = {}): Promise<ApiKeyRow[]> {
  return withDbRetry(async (sql) => {
    const rows = opts.createdBy
      ? await sql<DbApiKeyListRow[]>`
          select
            k.id, k.label, k.key_prefix, k.scopes, k.created_by,
            e.full_name as created_by_name, e.email as created_by_email,
            k.created_at::text as created_at, k.expires_at::text as expires_at,
            k.revoked_at::text as revoked_at
          from organelle.api_keys k
          left join organelle.employees e
            on e.auth_id = k.created_by and e.sandbox_tree_id is null
          where k.created_by = ${opts.createdBy}
          order by k.created_at desc
        `
      : await sql<DbApiKeyListRow[]>`
          select
            k.id, k.label, k.key_prefix, k.scopes, k.created_by,
            e.full_name as created_by_name, e.email as created_by_email,
            k.created_at::text as created_at, k.expires_at::text as expires_at,
            k.revoked_at::text as revoked_at
          from organelle.api_keys k
          left join organelle.employees e
            on e.auth_id = k.created_by and e.sandbox_tree_id is null
          order by k.created_at desc
        `;
    return rows.map(mapListRow);
  });
}

export async function findApiKeyByPrefix(
  keyPrefix: string,
): Promise<ApiKeyAuthRecord | null> {
  return withDbRetry(async (sql) => {
    const rows = await sql<
      {
        id: string;
        label: string;
        key_hash: string;
        scopes: string[];
        expires_at: string;
        revoked_at: string | null;
      }[]
    >`
      select id, label, key_hash, scopes, expires_at::text as expires_at,
             revoked_at::text as revoked_at
      from organelle.api_keys
      where key_prefix = ${keyPrefix}
      limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      label: row.label,
      keyHash: row.key_hash,
      scopes: row.scopes,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    };
  });
}

export async function createApiKey(input: {
  label: string;
  scopes: readonly IntegrationScope[];
  createdBy: string;
}): Promise<{ row: ApiKeyRow; secret: string } | { error: string }> {
  const label = input.label.trim();
  if (!label) return { error: "Label is required" };
  if (label.length > API_KEY_LABEL_MAX_LEN) {
    return { error: `Label must be ${API_KEY_LABEL_MAX_LEN} characters or less` };
  }
  const scopes = parseScopes(input.scopes);
  if (!scopes) return { error: "Invalid scopes" };

  const generated = generateApiKey();

  try {
    const row = await withDbRetry(async (sql) => {
      return sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext('organelle:api-keys:' || ${input.createdBy}))`;
        const counts = await tx<{ count: number }[]>`
          select count(*)::int as count from organelle.api_keys
          where created_by = ${input.createdBy}
            and revoked_at is null and expires_at > now()
        `;
        if ((counts[0]?.count ?? 0) >= 10) {
          throw new Error("active_api_key_limit");
        }
        const rows = await tx<DbApiKeyRow[]>`
          insert into organelle.api_keys
            (label, key_prefix, key_hash, scopes, created_by, expires_at)
          values (
            ${label},
            ${generated.keyPrefix},
            ${generated.keyHash},
            ${tx.array(scopes)},
            ${input.createdBy},
            now() + interval '90 days'
          )
          returning id, label, key_prefix, key_hash, scopes, created_by,
                    created_at::text as created_at, expires_at::text as expires_at,
                    revoked_at::text as revoked_at
        `;
        return mapCreatedRow(rows[0]!);
      });
    });
    return { row, secret: generated.secret };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("api_keys_key_prefix_uidx")) {
      return { error: "Failed to allocate key; retry" };
    }
    if (message.includes("active_api_key_limit")) {
      return { error: "An administrator can have at most 10 active API keys" };
    }
    throw error;
  }
}

export type RevokeApiKeyOpts = {
  /** When set, only revoke if created_by matches (developer). */
  createdBy?: string;
};

export async function revokeApiKey(
  keyId: string,
  opts: RevokeApiKeyOpts = {},
): Promise<{ ok: true; row: ApiKeyRow } | { ok: false; reason: string }> {
  const rows = await withDbRetry(async (sql) => {
    if (opts.createdBy) {
      return sql<DbApiKeyRow[]>`
        update organelle.api_keys
        set revoked_at = now()
        where id = ${keyId}
          and revoked_at is null
          and created_by = ${opts.createdBy}
        returning id, label, key_prefix, key_hash, scopes, created_by,
                  created_at::text as created_at, expires_at::text as expires_at,
                  revoked_at::text as revoked_at
      `;
    }
    return sql<DbApiKeyRow[]>`
      update organelle.api_keys
      set revoked_at = now()
      where id = ${keyId}
        and revoked_at is null
      returning id, label, key_prefix, key_hash, scopes, created_by,
                created_at::text as created_at, expires_at::text as expires_at,
                revoked_at::text as revoked_at
    `;
  });
  const row = rows[0];
  if (!row) {
    return {
      ok: false,
      reason: opts.createdBy
        ? "Key not found, already revoked, or not yours"
        : "Key not found or already revoked",
    };
  }
  return { ok: true, row: mapCreatedRow(row) };
}
