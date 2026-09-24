/**
 * Server-only Postgres client.
 *
 * The application uses one least-privileged PostgreSQL URL. Migrations use the
 * separate DATABASE_ADMIN_URL and never run in the web process.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import postgres from "postgres";

import { buildErrorLogFields, logEvent } from "@/lib/app-logging";

/** Concurrent PostgreSQL connections from this Node process. */
export const DB_POOL_MAX = Math.min(
  50,
  Math.max(1, Number.parseInt(process.env.DB_POOL_MAX ?? "10", 10) || 10),
);

const RETRYABLE =
  /socket disconnected|CONNECTION_CLOSED|CONNECTION_DESTROYED|bad_startup_payload|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ENETDOWN|ENETUNREACH|EHOSTUNREACH/;

export function isRetryableDbError(message: string): boolean {
  return RETRYABLE.test(message);
}

export function productionDatabaseUrlRequiresSsl(url: string): boolean {
  return /sslmode=(require|verify-ca|verify-full)/.test(url);
}

let client: postgres.Sql | null = null;

const readScope = new AsyncLocalStorage<{ sql: postgres.Sql; expired: boolean }>();

function createDb(max: number): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    max,
    prepare: false,
    ssl: productionDatabaseUrlRequiresSsl(url) ? "require" : undefined,
  });
}

export function getDb(): postgres.Sql {
  const scope = readScope.getStore();
  if (scope) {
    if (scope.expired) throw new DbReadTimeoutError();
    return scope.sql;
  }
  return (client ??= createDb(DB_POOL_MAX));
}

export class DbReadTimeoutError extends Error {
  readonly code = "DB_READ_TIMEOUT";
  constructor() {
    super("Database read deadline exceeded");
    this.name = "DbReadTimeoutError";
  }
}

/** A page-owned connection: cancelling a slow read never closes the shared pool.
 * SET LOCAL stays inside the read-only transaction.
 * The wall-clock deadline also covers connecting, queueing, and committing.
 */
export async function withReadOnlyDb<T>(
  fn: () => Promise<T>,
  options?: { timeoutMs?: number; attempts?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const attempts = options?.attempts ?? 3;
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; ; attempt++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new DbReadTimeoutError();
    const owned = createDb(1);
    const scope = { sql: owned, expired: false };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let callbackStarted = false;
    try {
      return await Promise.race([
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            scope.expired = true;
            reject(new DbReadTimeoutError());
          }, remainingMs);
        }),
        owned.begin("read only", async (tx) => {
          await tx`set local statement_timeout = '10s'`;
          // Existing read helpers accept Sql but use only its query interface.
          scope.sql = tx as unknown as postgres.Sql;
          callbackStarted = true;
          return readScope.run(scope, fn);
        }) as Promise<T>,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = !callbackStarted && isRetryableDbError(message);
      if (!retryable || attempt >= attempts - 1) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(250 * 2 ** attempt, 1000)),
      );
    } finally {
      clearTimeout(timer);
      scope.expired = true;
      await owned.end({ timeout: 0 });
    }
  }
}

export async function withDbRetry<T>(
  fn: (sql: postgres.Sql) => Promise<T>,
  options?: {
    attempts?: number;
    maxDurationMs?: number;
    logger?: string;
    operation?: string;
    fields?: Record<string, unknown>;
  },
): Promise<T> {
  // A failed PostgreSQL transaction cannot be retried in place. The page retry
  // starts a fresh scope; writes outside this scope retain their existing policy.
  if (readScope.getStore()) return fn(getDb());
  const attempts = options?.attempts ?? 10;
  const maxDurationMs = options?.maxDurationMs ?? 20_000;
  const started = Date.now();
  for (let i = 0; ; i++) {
    try {
      return await fn(getDb());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = isRetryableDbError(message);
      const timedOut = Date.now() - started >= maxDurationMs;
      const exhausted = i === attempts - 1 || timedOut;
      if (retryable && options?.logger && options.operation) {
        logEvent({
          level: exhausted ? "error" : "warning",
          logger: options.logger,
          message: exhausted
            ? "Database retry exhausted"
            : "Database retrying after failure",
          fields: {
            log_schema_version: 1,
            event_name: "database_retry",
            event_version: 1,
            operation: options.operation,
            result: exhausted ? "exhausted" : "retrying",
            retry_attempt: i + 1,
            retry_attempts: attempts,
            elapsed_ms: Date.now() - started,
            retryable: true,
            ...(options.fields ?? {}),
            ...buildErrorLogFields(error),
          },
        });
      }
      if (!retryable || exhausted) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(250 * 2 ** i, 3000)));
    }
  }
}
