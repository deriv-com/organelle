"use server";

/**
 * Integrations API key CRUD. admin only.
 * structured logging logs; no DB audit table.
 */

import { logEvent } from "@/lib/app-logging";
import { INTEGRATIONS_ROLES, requireRole } from "@/features/auth/session";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKeyRow,
} from "./api-keys-store";
import { parseScopes } from "./scopes";

import { UUID_RE } from "@/lib/uuid";

export type { ApiKeyRow } from "./api-keys-store";

export async function listApiKeysAction(): Promise<ApiKeyRow[] | { error: string }> {
  const access = await requireRole(INTEGRATIONS_ROLES);
  if (!access.ok) return { error: access.reason };
  return listApiKeys();
}

export async function createApiKeyAction(
  label: string,
  scopes: string[],
): Promise<
  { ok: true; row: ApiKeyRow; secret: string } | { ok: false; reason: string }
> {
  const access = await requireRole(INTEGRATIONS_ROLES);
  if (!access.ok) return { ok: false, reason: access.reason };

  const parsedScopes = parseScopes(scopes);
  if (!parsedScopes) {
    return { ok: false, reason: "Select at least one valid scope" };
  }

  const result = await createApiKey({
    label,
    scopes: parsedScopes,
    createdBy: access.actor.authId,
  });
  if ("error" in result) return { ok: false, reason: result.error };

  logEvent({
    level: "info",
    logger: "integrations.api_keys",
    message: "created",
    fields: {
      key_id: result.row.id,
      label: result.row.label,
      scopes: result.row.scopes,
      actor_auth_id: access.actor.authId,
    },
  });

  return { ok: true, row: result.row, secret: result.secret };
}

export async function revokeApiKeyAction(
  keyId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!UUID_RE.test(keyId)) return { ok: false, reason: "Unknown key" };
  const access = await requireRole(INTEGRATIONS_ROLES);
  if (!access.ok) return { ok: false, reason: access.reason };

  const result = await revokeApiKey(keyId);
  if (!result.ok) return result;

  logEvent({
    level: "info",
    logger: "integrations.api_keys",
    message: "revoked",
    fields: {
      key_id: result.row.id,
      label: result.row.label,
      scopes: result.row.scopes,
      actor_auth_id: access.actor.authId,
    },
  });

  return { ok: true };
}
