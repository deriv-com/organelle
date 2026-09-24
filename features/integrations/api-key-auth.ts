/**
 * Parallel machine auth for /api/integrations/**.
 * Does not use requireActor / employee mapping.
 */

import { keyPrefixFromSecret, parseBearerToken, secretsMatch } from "./api-key-crypto";
import { findApiKeyByPrefix, type ApiKeyAuthRecord } from "./api-keys-store";
import { hasAllScopes, type IntegrationScope } from "./scopes";

export type ApiKeyActor = {
  keyId: string;
  label: string;
  scopes: string[];
};

export type RequireApiKeyResult =
  { ok: true; actor: ApiKeyActor } | { ok: false; status: 401 | 403; reason: string };

export type ApiKeyLookup = (keyPrefix: string) => Promise<ApiKeyAuthRecord | null>;

export async function requireApiKey(
  requiredScopes: readonly IntegrationScope[],
  request: Request,
  lookup: ApiKeyLookup = findApiKeyByPrefix,
): Promise<RequireApiKeyResult> {
  const secret = parseBearerToken(request.headers.get("authorization"));
  if (!secret) {
    return { ok: false, status: 401, reason: "Missing or invalid API key" };
  }

  const record = await lookup(keyPrefixFromSecret(secret));
  const expiresAt = record ? Date.parse(record.expiresAt) : Number.NaN;
  if (
    !record ||
    record.revokedAt ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    return { ok: false, status: 401, reason: "Missing or invalid API key" };
  }
  if (!secretsMatch(secret, record.keyHash)) {
    return { ok: false, status: 401, reason: "Missing or invalid API key" };
  }
  if (!hasAllScopes(record.scopes, requiredScopes)) {
    return { ok: false, status: 403, reason: "Insufficient scope" };
  }

  return {
    ok: true,
    actor: {
      keyId: record.id,
      label: record.label,
      scopes: record.scopes,
    },
  };
}

export function jsonApiKeyDenied(status: 401 | 403, reason: string): Response {
  return Response.json({ error: reason }, { status });
}
