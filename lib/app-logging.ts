import {
  buildLogPayload,
  httpStatusToLogLevel,
  logPathFromUrl,
  shouldLog,
  type BuildLogPayloadOptions,
  type AppLogLevel,
} from "../logging/log-core";
import { buildErrorLogFields } from "../logging/error-fields";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type { AppLogLevel };
export { buildErrorLogFields };
export { httpStatusToLogLevel, logPathFromUrl };

export const LOG_SCHEMA_VERSION = 1;
export const DEFAULT_EVENT_VERSION = 1;

type LogFields = Record<string, unknown>;

type LogEventOptions = {
  logger: string;
  operation: string;
  eventName?: string;
  eventVersion?: number;
  message?: string;
  startedAt?: number;
  fields?: LogFields;
};

type LogActionResultOptions = LogEventOptions & {
  level?: AppLogLevel;
  result: string;
  failureReason?: string;
};

type LogActionRejectedOptions = LogEventOptions & {
  level?: AppLogLevel;
  failureReason: string;
};

type LogActionErrorOptions = LogEventOptions & {
  error: unknown;
  result?: string;
  failureReason?: string;
};

type LogRouteErrorOptions = LogEventOptions & {
  error: unknown;
  httpPath?: string;
  httpMethod?: string;
  httpStatusCode?: number;
};

export function buildAppLogPayload(
  options: BuildLogPayloadOptions,
): Record<string, JsonValue> {
  return buildLogPayload(options);
}

export function logStart(): number {
  return performance.now();
}

export function timedLogFields(startedAt: number | undefined): LogFields {
  if (startedAt === undefined) return {};
  return { duration_ms: Number((performance.now() - startedAt).toFixed(2)) };
}

function enrichedFields(options: LogEventOptions, extra: LogFields = {}): LogFields {
  return {
    log_schema_version: LOG_SCHEMA_VERSION,
    event_name: options.eventName ?? options.operation,
    event_version: options.eventVersion ?? DEFAULT_EVENT_VERSION,
    operation: options.operation,
    ...timedLogFields(options.startedAt),
    ...(options.fields ?? {}),
    ...extra,
  };
}

export function logEvent(options: BuildLogPayloadOptions): void {
  if (!shouldLog(options.level)) return;

  const payload = buildAppLogPayload(options);

  if ((process.env.APP_LOG_FORMAT || "json").toLowerCase() === "text") {
    const message = String(payload.message).replace(/[\r\n\u2028\u2029]+/g, " ");
    console.log(
      `${payload.timestamp} [${payload.level}] ${payload.logger}: ${message}`,
    );
    return;
  }

  console.log(JSON.stringify(payload));
}

export function logActionResult(options: LogActionResultOptions): void {
  const level = options.level ?? (options.result === "success" ? "info" : "warning");
  logEvent({
    level,
    logger: options.logger,
    message: options.message ?? `${options.operation} ${options.result}`,
    fields: enrichedFields(options, {
      result: options.result,
      failure_reason: options.failureReason,
    }),
  });
}

export function logActionRejected(options: LogActionRejectedOptions): void {
  logActionResult({
    ...options,
    result: "rejected",
  });
}

export function logActionError(options: LogActionErrorOptions): void {
  logEvent({
    level: "error",
    logger: options.logger,
    message: options.message ?? `${options.operation} failed`,
    fields: enrichedFields(options, {
      result: options.result ?? "error",
      failure_reason: options.failureReason,
      ...buildErrorLogFields(options.error),
    }),
  });
}

export function logRouteError(options: LogRouteErrorOptions): void {
  const httpPath = options.httpPath ? logPathFromUrl(options.httpPath) : undefined;
  logEvent({
    level: "error",
    logger: options.logger,
    message: options.message ?? `${options.operation} route failed`,
    fields: enrichedFields(options, {
      result: "error",
      http_method: options.httpMethod,
      http_path: httpPath,
      http_status_code: options.httpStatusCode ?? 500,
      ...buildErrorLogFields(options.error),
    }),
  });
}
