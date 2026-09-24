const INSECURE_AUTH_SECRETS = new Set([
  "change-this-before-production",
  "replace-with-at-least-32-random-bytes",
  "development-secret",
]);

export function assertSecureProductionConfig(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== "production") return;
  if (env.NEXT_PHASE === "phase-production-build") return;

  const secret = env.AUTH_SECRET?.trim() ?? "";
  if (secret.length < 32 || INSECURE_AUTH_SECRETS.has(secret.toLowerCase())) {
    throw new Error(
      "AUTH_SECRET must be a non-placeholder value of at least 32 characters in production",
    );
  }
}
