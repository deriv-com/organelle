/**
 * API key material. Secret shown once; store hash + prefix only.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_PREFIX_LEN = 12; // "org_" + 8 chars of material
const SECRET_BYTES = 24;

export type GeneratedApiKey = {
  secret: string;
  keyPrefix: string;
  keyHash: string;
};

export function hashApiKeySecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function keyPrefixFromSecret(secret: string): string {
  return secret.slice(0, KEY_PREFIX_LEN);
}

export function generateApiKey(): GeneratedApiKey {
  const material = randomBytes(SECRET_BYTES).toString("base64url");
  const secret = `org_${material}`;
  return {
    secret,
    keyPrefix: keyPrefixFromSecret(secret),
    keyHash: hashApiKeySecret(secret),
  };
}

export function secretsMatch(presented: string, storedHash: string): boolean {
  const presentedHash = hashApiKeySecret(presented);
  try {
    const a = Buffer.from(presentedHash, "hex");
    const b = Buffer.from(storedHash, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function parseBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (!match) return null;
  const token = match[1]!;
  if (!token.startsWith("org_")) return null;
  return token;
}
