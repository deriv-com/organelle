/* eslint-disable @typescript-eslint/no-require-imports */
const { AsyncLocalStorage } = require("node:async_hooks");
const { randomUUID } = require("node:crypto");
const http = require("node:http");
const util = require("node:util");

const { buildErrorLogFields } = require("./logging/error-fields.cjs");
const { redactSensitiveText } = require("./logging/redaction.cjs");
const {
  buildLogPayload,
  envValue,
  httpStatusToLogLevel,
  logPathFromUrl,
  shouldLog,
} = require("./logging/log-core.cjs");

const ATTACHED = Symbol.for("organelle.logging.request_logger_attached");
const CONSOLE_CAPTURED = Symbol.for("organelle.logging.console_captured");

const recentRequestErrorDigests = new Map();
const requestLogContext = new AsyncLocalStorage();
let stderrLineBuffer = "";
const STDERR_LINE_BUFFER_MAX = 64 * 1024;

function currentRequestLogContext() {
  return requestLogContext.getStore() || {};
}

function normalizeRequestId(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 128) return "";
  return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : "";
}

function requestIdFromIncoming(req) {
  return normalizeRequestId(req.headers?.["x-request-id"]) || randomUUID();
}

function runWithRequestLogContext(context, fn) {
  return requestLogContext.run(context, fn);
}

function isStructuredLogPayload(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = JSON.parse(value);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.timestamp === "string" &&
      typeof parsed.message === "string" &&
      (typeof parsed.status === "string" || typeof parsed.level === "string") &&
      typeof parsed.logger === "string"
    );
  } catch {
    return false;
  }
}

function emitStructuredLog(options) {
  if (!shouldLog(options.level)) return;
  writeStructuredLine(JSON.stringify(buildLogPayload(options)));
}

function writeStructuredLine(line) {
  originalConsoleLog(line);
}

function logEvent(options) {
  if (!shouldLog(options.level)) return;

  const payload = buildLogPayload(options);

  if ((envValue("APP_LOG_FORMAT") || "json").toLowerCase() === "text") {
    const message = String(payload.message).replace(/[\r\n\u2028\u2029]+/g, " ");
    originalConsoleLog(
      `${payload.timestamp} [${payload.level}] ${payload.logger}: ${message}`,
    );
    return;
  }

  writeStructuredLine(JSON.stringify(payload));
}

function sanitizedTextArgs(args) {
  return redactSensitiveText(
    args.map((value) => safeStringify(value)).join(" "),
  ).replace(/[\r\n\u2028\u2029]+/g, " ");
}

function noteRequestErrorLogged(digest) {
  if (typeof digest !== "string" || !digest) return;
  recentRequestErrorDigests.set(digest, Date.now());
  pruneRecentRequestErrorDigests();
}

function pruneRecentRequestErrorDigests() {
  const cutoff = Date.now() - 1000;
  for (const [digest, loggedAt] of recentRequestErrorDigests.entries()) {
    if (loggedAt < cutoff) recentRequestErrorDigests.delete(digest);
  }
}

function shouldSuppressCapturedError(error) {
  if (!(error instanceof Error)) return false;
  const digest = typeof error.digest === "string" ? error.digest : "";
  if (!digest) return false;
  pruneRecentRequestErrorDigests();
  return recentRequestErrorDigests.has(digest);
}

function safeStringify(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message || value.name || "Error";
  try {
    return util.inspect(value, { depth: 4, breakLength: Infinity, compact: true });
  } catch {
    return String(value);
  }
}

function captureConsoleArgs(args, level, logger) {
  const firstError = args.find((arg) => arg instanceof Error);
  if (firstError && shouldSuppressCapturedError(firstError)) {
    return { suppressed: true };
  }

  const fields = firstError ? buildErrorLogFields(firstError) : {};
  let message = "";

  if (args.length === 0) {
    message = "(empty console output)";
  } else if (args.length === 1) {
    if (typeof args[0] === "string") {
      message = args[0];
    } else if (args[0] instanceof Error) {
      message = args[0].message || args[0].name || "Error";
    } else {
      message = safeStringify(args[0]);
    }
  } else {
    const stringParts = args
      .filter((arg) => typeof arg === "string")
      .map((arg) => arg.trim())
      .filter(Boolean);
    message = stringParts.join(" ") || safeStringify(args[0]);
  }

  return {
    level,
    logger,
    message,
    fields,
  };
}

function flushStderrLineBuffer(force = false) {
  if (!stderrLineBuffer) return;
  if (!force && !stderrLineBuffer.includes("\n")) return;

  const lines = stderrLineBuffer.split("\n");
  if (force) {
    stderrLineBuffer = "";
  } else {
    stderrLineBuffer = lines.pop() ?? "";
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isStructuredLogPayload(trimmed)) {
      writeStructuredLine(trimmed);
      continue;
    }
    emitStructuredLog({
      level: "error",
      logger: "node.stderr",
      message: trimmed,
      fields: {},
    });
  }

  if (force && stderrLineBuffer.trim()) {
    const trimmed = stderrLineBuffer.trim();
    stderrLineBuffer = "";
    if (isStructuredLogPayload(trimmed)) {
      writeStructuredLine(trimmed);
    } else {
      emitStructuredLog({
        level: "error",
        logger: "node.stderr",
        message: trimmed,
        fields: {},
      });
    }
  }
}

let originalConsoleLog = console.log.bind(console);
let originalConsoleError = console.error.bind(console);
let originalConsoleWarn = console.warn.bind(console);
let originalStderrWrite = process.stderr.write.bind(process.stderr);

function installConsoleCapture() {
  if (console[CONSOLE_CAPTURED]) return;
  console[CONSOLE_CAPTURED] = true;

  originalConsoleLog = console.log.bind(console);
  originalConsoleError = console.error.bind(console);
  originalConsoleWarn = console.warn.bind(console);
  originalStderrWrite = process.stderr.write.bind(process.stderr);

  console.log = (...args) => {
    if ((envValue("APP_LOG_FORMAT") || "json").toLowerCase() === "text") {
      originalConsoleLog(sanitizedTextArgs(args));
      return;
    }
    if (
      args.length === 1 &&
      typeof args[0] === "string" &&
      isStructuredLogPayload(args[0])
    ) {
      originalConsoleLog(args[0]);
      return;
    }
    const captured = captureConsoleArgs(args, "info", "node.console.log");
    if (captured.suppressed) return;
    emitStructuredLog(captured);
  };

  console.error = (...args) => {
    if ((envValue("APP_LOG_FORMAT") || "json").toLowerCase() === "text") {
      originalConsoleError(sanitizedTextArgs(args));
      return;
    }
    if (
      args.length === 1 &&
      typeof args[0] === "string" &&
      isStructuredLogPayload(args[0])
    ) {
      originalConsoleLog(args[0]);
      return;
    }
    const captured = captureConsoleArgs(args, "error", "node.console.error");
    if (captured.suppressed) return;
    emitStructuredLog(captured);
  };

  console.warn = (...args) => {
    if ((envValue("APP_LOG_FORMAT") || "json").toLowerCase() === "text") {
      originalConsoleWarn(sanitizedTextArgs(args));
      return;
    }
    if (
      args.length === 1 &&
      typeof args[0] === "string" &&
      isStructuredLogPayload(args[0])
    ) {
      originalConsoleLog(args[0]);
      return;
    }
    const captured = captureConsoleArgs(args, "warning", "node.console.warn");
    if (captured.suppressed) return;
    emitStructuredLog(captured);
  };

  process.stderr.write = function organelleStderrWrite(chunk, encoding, callback) {
    if ((envValue("APP_LOG_FORMAT") || "json").toLowerCase() === "text") {
      const raw = Buffer.isBuffer(chunk)
        ? chunk.toString(typeof encoding === "string" ? encoding : "utf8")
        : String(chunk);
      const safe = redactSensitiveText(raw).replace(/[\r\n\u2028\u2029]+/g, " ");
      return originalStderrWrite(safe, encoding, callback);
    }

    const text = Buffer.isBuffer(chunk)
      ? chunk.toString(typeof encoding === "string" ? encoding : "utf8")
      : String(chunk);
    stderrLineBuffer += text;
    if (stderrLineBuffer.length > STDERR_LINE_BUFFER_MAX) {
      stderrLineBuffer = `${stderrLineBuffer.slice(0, STDERR_LINE_BUFFER_MAX)}[truncated]\n`;
    }
    flushStderrLineBuffer(false);

    if (typeof encoding === "function") {
      encoding(null);
    } else if (typeof callback === "function") {
      callback(null);
    }
    return true;
  };
}

function installHttpRequestLogging() {
  if (http.createServer.__organelleLoggingWrapped) return;

  const originalCreateServer = http.createServer;
  function wrappedCreateServer(options, requestListener) {
    if (typeof options === "function") {
      return originalCreateServer.call(http, wrapRequestListener(options));
    }
    if (typeof requestListener === "function") {
      return originalCreateServer.call(
        http,
        options,
        wrapRequestListener(requestListener),
      );
    }
    return originalCreateServer.apply(http, arguments);
  }

  wrappedCreateServer.__organelleLoggingWrapped = true;
  http.createServer = wrappedCreateServer;
}

function wrapRequestListener(listener) {
  return function organelleLoggingRequestListener(req, res) {
    const requestId = requestIdFromIncoming(req);
    return runWithRequestLogContext({ request_id: requestId }, () => {
      attachRequestLogger(req, res, requestId);
      return listener.call(this, req, res);
    });
  };
}

function attachRequestLogger(
  req,
  res,
  requestId = currentRequestLogContext().request_id || requestIdFromIncoming(req),
) {
  if (res[ATTACHED]) return;
  res[ATTACHED] = true;
  const started = process.hrtime.bigint();

  res.once("finish", () => {
    const path = logPathFromUrl(req.url);
    if (path === "/api/health") return;

    const statusCode = Number(res.statusCode) || 0;
    const durationMs = Number(
      (Number(process.hrtime.bigint() - started) / 1_000_000).toFixed(2),
    );
    const method = req.method || "GET";
    const level = httpStatusToLogLevel(statusCode);

    logEvent({
      level,
      logger: "next.http",
      message: `HTTP ${method} ${path} -> ${statusCode}`,
      fields: {
        request_id: requestId,
        http_method: method,
        http_path: path,
        http_status_code: statusCode,
        duration_ms: durationMs,
      },
    });
  });
}

if (process.env.ORGANELLE_SKIP_LOGGING_PRELOAD_INSTALL !== "1") {
  installHttpRequestLogging();
}

if (process.env.ORGANELLE_SKIP_CONSOLE_CAPTURE !== "1") {
  installConsoleCapture();
}

globalThis.__organelleNoteRequestErrorLogged = noteRequestErrorLogged;
globalThis.__organelleGetRequestLogContext = currentRequestLogContext;

module.exports = {
  attachRequestLogger,
  buildErrorLogFields,
  buildLogPayload,
  captureConsoleArgs,
  currentRequestLogContext,
  flushStderrLineBuffer,
  httpStatusToLogLevel,
  installConsoleCapture,
  installHttpRequestLogging,
  isStructuredLogPayload,
  logPathFromUrl,
  noteRequestErrorLogged,
  requestIdFromIncoming,
  runWithRequestLogContext,
  writeStructuredLine,
};
