import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildAppLogPayload,
  buildErrorLogFields,
  httpStatusToLogLevel,
  logActionRejected,
  logActionResult,
  logPathFromUrl,
  logRouteError,
} from "./app-logging";
import { withDbRetry } from "./db";

const require = createRequire(import.meta.url);
const OLD_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...OLD_ENV };
  delete (
    globalThis as typeof globalThis & {
      __organelleGetRequestLogContext?: () => Record<string, unknown> | undefined;
    }
  ).__organelleGetRequestLogContext;
});

describe("application logging", () => {
  it("builds parseable structured logging JSON fields", () => {
    process.env.APP_LOG_SERVICE = "organelle";
    process.env.APP_ENV = "test";
    process.env.APP_VERSION = "abc123";

    const payload = buildAppLogPayload({
      level: "warning",
      logger: "test.logger",
      message: "sample message",
      fields: {
        http_method: "GET",
        http_path: "/chart",
        http_status_code: 404,
        duration_ms: 12.5,
      },
      now: new Date("2026-08-25T00:00:00.000Z"),
    });

    expect(payload).toMatchObject({
      timestamp: "2026-08-25T00:00:00.000Z",
      status: "warning",
      level: "warning",
      logger: "test.logger",
      message: "sample message",
      service: "organelle",
      env: "test",
      version: "abc123",
      http_method: "GET",
      http_path: "/chart",
      http_status_code: 404,
      duration_ms: 12.5,
    });
  });

  it("maps HTTP status codes to structured logging severities", () => {
    expect(httpStatusToLogLevel(200)).toBe("info");
    expect(httpStatusToLogLevel(302)).toBe("info");
    expect(httpStatusToLogLevel(400)).toBe("warning");
    expect(httpStatusToLogLevel(499)).toBe("warning");
    expect(httpStatusToLogLevel(500)).toBe("error");
  });

  it("removes query strings from logged request paths", () => {
    expect(
      logPathFromUrl(
        "https://organelle.example.com/api/export/changes?date=2026-08-25",
      ),
    ).toBe("/api/export/changes");
    expect(logPathFromUrl("/directory?search=private")).toBe("/directory");
  });

  it("drops sensitive fields recursively", () => {
    const payload = buildAppLogPayload({
      level: "info",
      logger: "test.logger",
      message: "failed with api_key=abc123456789",
      fields: {
        http_path: "/chart",
        headers: { authorization: "Bearer secret" },
        cookies: "secret",
        x_api_key: "secret-key",
        safe_note: "upstream returned token=abc123456789",
        nested: {
          token: "secret",
          safe: "kept",
        },
      },
      now: new Date("2026-08-25T00:00:00.000Z"),
    });

    expect(payload).not.toHaveProperty("headers");
    expect(payload).not.toHaveProperty("cookies");
    expect(payload).not.toHaveProperty("x_api_key");
    expect(payload.nested).toEqual({ safe: "kept" });
    expect(payload.message).toBe("failed with api_key=[REDACTED]");
    expect(payload.safe_note).toBe("upstream returned token=[REDACTED]");
  });

  it("adds request context fields without keeping sensitive context", () => {
    (
      globalThis as typeof globalThis & {
        __organelleGetRequestLogContext?: () => Record<string, unknown>;
      }
    ).__organelleGetRequestLogContext = () => ({
      request_id: "req-123",
      headers: { authorization: "Bearer secret" },
    });

    const payload = buildAppLogPayload({
      level: "info",
      logger: "test.logger",
      message: "safe",
      fields: {
        operation: "sample",
      },
      now: new Date("2026-08-25T00:00:00.000Z"),
    });

    expect(payload.request_id).toBe("req-123");
    expect(payload).not.toHaveProperty("headers");
    expect(payload.operation).toBe("sample");
  });

  it("formats error fields without request data", () => {
    const error = new TypeError("broken");
    error.stack = "stack";
    Object.assign(error, { digest: "digest-1" });

    expect(buildErrorLogFields(error)).toEqual({
      "error.kind": "TypeError",
      "error.message": "broken",
      "error.stack": "stack",
      digest: "digest-1",
    });
  });

  it("redacts sensitive values inside error text", () => {
    const error = new Error("request failed with authorization: Bearer abc123456789");
    error.stack = "Error: database_url=postgres://app_user:test-only@localhost/app";

    expect(buildErrorLogFields(error)).toMatchObject({
      "error.message": "request failed with authorization: [REDACTED]",
      "error.stack": "Error: database_url=[REDACTED]",
    });
  });

  it("includes postgres driver triage fields but not DETAIL/HINT row values", () => {
    const error = new Error("duplicate key value violates unique constraint");
    Object.assign(error, {
      code: "23505",
      severity_local: "ERROR",
      severity: "ERROR",
      detail: "Key (email)=(someone@example.com) already exists.",
      hint: "check pooler host",
      errno: "ENOTFOUND",
    });

    expect(buildErrorLogFields(error)).toMatchObject({
      "error.kind": "Error",
      code: "23505",
      severity_local: "ERROR",
      severity: "ERROR",
      errno: "ENOTFOUND",
    });
    expect(buildErrorLogFields(error)).not.toHaveProperty("detail");
    expect(buildErrorLogFields(error)).not.toHaveProperty("hint");
  });

  it("matches server-logging error field extraction", () => {
    process.env.ORGANELLE_SKIP_LOGGING_PRELOAD_INSTALL = "1";
    process.env.ORGANELLE_SKIP_CONSOLE_CAPTURE = "1";

    const error = new Error("db failed");
    error.stack = "stack";
    Object.assign(error, { digest: "digest-1", code: "XX000" });

    const logging = require("../server-logging.cjs") as {
      buildErrorLogFields: typeof buildErrorLogFields;
    };

    expect(buildErrorLogFields(error)).toEqual(logging.buildErrorLogFields(error));
  });
});

describe("structured logging app log helpers", () => {
  const originalConsoleLog = console.log;
  let capturedLines: string[] = [];

  beforeEach(() => {
    capturedLines = [];
    process.env.APP_LOG_FORMAT = "json";
    process.env.APP_LOG_LEVEL = "INFO";
    console.log = ((...args: unknown[]) => {
      for (const arg of args) {
        if (typeof arg === "string") capturedLines.push(arg);
      }
    }) as typeof console.log;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  it("logs enriched action metadata", () => {
    logActionResult({
      logger: "test.actions",
      operation: "move_node",
      eventName: "sandbox.node_move.result",
      result: "rejected",
      failureReason: "Someone else moved this — reload",
      startedAt: performance.now(),
      fields: {
        actor_auth_id: "actor-1",
        actor_role: "editor",
        tree_id: "tree-1",
        node_id: "node-1",
        request_body: "must disappear",
      },
    });

    expect(capturedLines).toHaveLength(1);
    const payload = JSON.parse(capturedLines[0]!) as Record<string, unknown>;
    expect(payload).toMatchObject({
      status: "warning",
      logger: "test.actions",
      log_schema_version: 1,
      event_name: "sandbox.node_move.result",
      event_version: 1,
      operation: "move_node",
      result: "rejected",
      failure_reason: "Someone else moved this — reload",
      actor_auth_id: "actor-1",
      actor_role: "editor",
      tree_id: "tree-1",
      node_id: "node-1",
    });
    expect(payload).toHaveProperty("duration_ms");
    expect(payload).not.toHaveProperty("request_body");
  });

  it("logs rejected validation metadata", () => {
    logActionRejected({
      logger: "test.actions",
      operation: "create_node",
      eventName: "sandbox.node_create.result",
      failureReason: "Malformed id",
      fields: {
        validation_target: "tree_id",
        request_body: "must disappear",
      },
    });

    expect(capturedLines).toHaveLength(1);
    const payload = JSON.parse(capturedLines[0]!) as Record<string, unknown>;
    expect(payload).toMatchObject({
      status: "warning",
      logger: "test.actions",
      operation: "create_node",
      event_name: "sandbox.node_create.result",
      result: "rejected",
      failure_reason: "Malformed id",
      validation_target: "tree_id",
    });
    expect(payload).not.toHaveProperty("request_body");
  });

  it("logs route errors with sanitized path and error fields", () => {
    const error = new Error("failed");
    Object.assign(error, { code: "XX000" });

    logRouteError({
      logger: "test.route",
      operation: "export_changes_csv",
      eventName: "reports.changes_export.error",
      error,
      httpMethod: "GET",
      httpPath: "https://organelle.example.com/api/export/changes?date=2026-08-25",
    });

    const payload = JSON.parse(capturedLines[0]!) as Record<string, unknown>;
    expect(payload).toMatchObject({
      status: "error",
      operation: "export_changes_csv",
      event_name: "reports.changes_export.error",
      result: "error",
      http_method: "GET",
      http_path: "/api/export/changes",
      http_status_code: 500,
      "error.kind": "Error",
      "error.message": "failed",
      code: "XX000",
    });
  });
});

describe("database retry logging", () => {
  const originalConsoleLog = console.log;
  let capturedLines: string[] = [];

  beforeEach(() => {
    capturedLines = [];
    process.env.APP_LOG_FORMAT = "json";
    process.env.APP_LOG_LEVEL = "INFO";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:1/db";
    console.log = ((...args: unknown[]) => {
      for (const arg of args) {
        if (typeof arg === "string") capturedLines.push(arg);
      }
    }) as typeof console.log;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  it("logs retryable database attempts as warnings", async () => {
    let attempts = 0;
    await withDbRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("socket disconnected");
        return "ok";
      },
      {
        attempts: 2,
        logger: "test.db",
        operation: "load_test",
        fields: { tree_id: "tree-1" },
      },
    );

    expect(capturedLines).toHaveLength(1);
    const payload = JSON.parse(capturedLines[0]!) as Record<string, unknown>;
    expect(payload).toMatchObject({
      status: "warning",
      logger: "test.db",
      event_name: "database_retry",
      operation: "load_test",
      result: "retrying",
      retry_attempt: 1,
      retry_attempts: 2,
      retryable: true,
      tree_id: "tree-1",
    });
  });

  it("logs exhausted database retries as errors", async () => {
    await expect(
      withDbRetry(
        async () => {
          throw new Error("ECONNRESET");
        },
        {
          attempts: 1,
          logger: "test.db",
          operation: "load_test",
        },
      ),
    ).rejects.toThrow("ECONNRESET");

    expect(capturedLines).toHaveLength(1);
    const payload = JSON.parse(capturedLines[0]!) as Record<string, unknown>;
    expect(payload).toMatchObject({
      status: "error",
      logger: "test.db",
      event_name: "database_retry",
      operation: "load_test",
      result: "exhausted",
      retry_attempt: 1,
      retry_attempts: 1,
      retryable: true,
    });
  });
});

describe("HTTP preload helpers", () => {
  it("uses the same safe payload and path behavior", () => {
    process.env.ORGANELLE_SKIP_LOGGING_PRELOAD_INSTALL = "1";
    process.env.ORGANELLE_SKIP_CONSOLE_CAPTURE = "1";
    process.env.APP_LOG_SERVICE = "organelle";
    process.env.APP_ENV = "test";
    delete require.cache[require.resolve("../server-logging.cjs")];

    const logging = require("../server-logging.cjs") as {
      buildLogPayload: typeof buildAppLogPayload;
      httpStatusToLogLevel: typeof httpStatusToLogLevel;
      logPathFromUrl: typeof logPathFromUrl;
      runWithRequestLogContext: <T>(context: Record<string, unknown>, fn: () => T) => T;
    };

    expect(logging.httpStatusToLogLevel(503)).toBe("error");
    expect(logging.logPathFromUrl("/api/sandboxes?token=secret")).toBe(
      "/api/sandboxes",
    );
    expect(
      logging.buildLogPayload({
        level: "info",
        logger: "next.http",
        message: "HTTP GET /chart -> 200",
        fields: {
          http_path: "/chart",
          authorization: "Bearer secret",
        },
        now: new Date("2026-08-25T00:00:00.000Z"),
      }),
    ).not.toHaveProperty("authorization");

    const withContext = logging.runWithRequestLogContext(
      { request_id: "req-cjs" },
      () =>
        logging.buildLogPayload({
          level: "info",
          logger: "next.http",
          message: "HTTP GET /chart -> 200",
          fields: { http_path: "/chart" },
          now: new Date("2026-08-25T00:00:00.000Z"),
        }),
    );
    expect(withContext.request_id).toBe("req-cjs");
  });
});

function loadServerLoggingModule() {
  process.env.ORGANELLE_SKIP_LOGGING_PRELOAD_INSTALL = "1";
  delete require.cache[require.resolve("../server-logging.cjs")];
  return require("../server-logging.cjs") as {
    installConsoleCapture: () => void;
    isStructuredLogPayload: (value: string) => boolean;
    noteRequestErrorLogged: (digest: string) => void;
    requestIdFromIncoming: (req: {
      headers?: Record<string, string | string[] | undefined>;
    }) => string;
    runWithRequestLogContext: <T>(context: Record<string, unknown>, fn: () => T) => T;
  };
}

describe("console capture", () => {
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let capturedLines: string[] = [];

  beforeEach(() => {
    capturedLines = [];
    process.env.APP_LOG_FORMAT = "json";
    process.env.APP_LOG_LEVEL = "INFO";
    process.env.ORGANELLE_SKIP_CONSOLE_CAPTURE = "1";
    delete (console as Console & Record<symbol, unknown>)[
      Symbol.for("organelle.logging.console_captured")
    ];
    console.log = ((...args: unknown[]) => {
      for (const arg of args) {
        if (typeof arg === "string") capturedLines.push(arg);
      }
    }) as typeof console.log;
    console.error = ((...args: unknown[]) => {
      console.log(...args);
    }) as typeof console.error;
    console.warn = ((...args: unknown[]) => {
      console.log(...args);
    }) as typeof console.warn;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      const text =
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      console.log(text);
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    process.stderr.write = originalStderrWrite;
    delete (console as Console & Record<symbol, unknown>)[
      Symbol.for("organelle.logging.console_captured")
    ];
    delete require.cache[require.resolve("../server-logging.cjs")];
  });

  it("passes through existing structured JSON logs unchanged", () => {
    const logging = loadServerLoggingModule();
    logging.installConsoleCapture();

    const structured = JSON.stringify({
      timestamp: "2026-08-25T00:00:00.000Z",
      status: "error",
      level: "error",
      logger: "next.request",
      message: "Server request error on GET /chart",
      service: "organelle",
    });

    console.log(structured);

    expect(capturedLines).toEqual([structured]);
    expect(logging.isStructuredLogPayload(structured)).toBe(true);
  });

  it("converts multiline console.error output to one JSON line", () => {
    const logging = loadServerLoggingModule();
    logging.installConsoleCapture();

    const error = new Error("db failed");
    error.stack = "Error: db failed\n    at line1\n    at line2";
    Object.assign(error, {
      digest: "1483351276",
      code: "XX000",
      severity_local: "FATAL",
    });

    console.error(error);

    expect(capturedLines).toHaveLength(1);
    const payload = JSON.parse(capturedLines[0]!) as Record<string, unknown>;
    expect(payload.logger).toBe("node.console.error");
    expect(payload.status).toBe("error");
    expect(payload.message).toBe("db failed");
    expect(payload.code).toBe("XX000");
    expect(payload.severity_local).toBe("FATAL");
    expect(payload["error.stack"]).toBe(error.stack);
  });

  it("adds request context to captured console output", () => {
    const logging = loadServerLoggingModule();
    logging.installConsoleCapture();

    logging.runWithRequestLogContext({ request_id: "req-console" }, () => {
      console.warn("inside request");
    });

    expect(capturedLines).toHaveLength(1);
    const payload = JSON.parse(capturedLines[0]!) as Record<string, unknown>;
    expect(payload.logger).toBe("node.console.warn");
    expect(payload.request_id).toBe("req-console");
  });

  it("uses incoming request IDs only when they are safe", () => {
    const logging = loadServerLoggingModule();

    expect(
      logging.requestIdFromIncoming({ headers: { "x-request-id": "req-abc_123" } }),
    ).toBe("req-abc_123");
    expect(
      logging.requestIdFromIncoming({
        headers: { "x-request-id": "bad id with spaces" },
      }),
    ).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("suppresses duplicate console.error after noteRequestErrorLogged", () => {
    const logging = loadServerLoggingModule();
    logging.installConsoleCapture();

    const error = new Error("already logged");
    Object.assign(error, { digest: "digest-1" });

    logging.noteRequestErrorLogged("digest-1");
    console.error(error);

    expect(capturedLines).toHaveLength(0);
  });

  it("converts stderr multiline writes to structured JSON lines", () => {
    const logging = loadServerLoggingModule();
    logging.installConsoleCapture();

    process.stderr.write("line one\nline two\n");

    expect(capturedLines).toHaveLength(2);
    expect(JSON.parse(capturedLines[0]!).message).toBe("line one");
    expect(JSON.parse(capturedLines[1]!).message).toBe("line two");
  });

  it("caps a newline-less stderr write instead of growing unbounded", () => {
    const logging = loadServerLoggingModule();
    logging.installConsoleCapture();

    process.stderr.write("x".repeat(70_000));

    expect(capturedLines).toHaveLength(1);
    const payload = JSON.parse(capturedLines[0]!) as { message: string };
    expect(payload.message.length).toBeLessThanOrEqual(65_536 + 20);
    expect(payload.message.endsWith("[truncated]")).toBe(true);
  });
});
