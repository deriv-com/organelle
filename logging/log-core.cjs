/* eslint-disable @typescript-eslint/no-require-imports */
const { redactSensitiveText } = require("./redaction.cjs");

const LEVEL_WEIGHT = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
};

const SENSITIVE_SUBSTRINGS = [
  "access_token",
  "api_key",
  "apikey",
  "authorization",
  "bearer",
  "body",
  "cf-access-jwt-assertion",
  "cf_jwt",
  "cookie",
  "cookies",
  "database_url",
  "dd_api_key",
  "email",
  "headers",
  "jwt",
  "key_hash",
  "password",
  "refresh_token",
  "request_body",
  "secret",
  "set_cookie",
  "token",
  "x_api_key",
];

function normalizeKey(key) {
  return key.toLowerCase().replace(/-/g, "_");
}

function isSensitiveKey(key) {
  const normalized = normalizeKey(key);
  return SENSITIVE_SUBSTRINGS.some((part) => normalized.includes(part));
}

function envValue(key) {
  return (process.env[key] || "").trim();
}

function normalizeLevel(value) {
  const normalized = value.trim().toLowerCase();
  if (["debug", "info", "warning", "error"].includes(normalized)) return normalized;
  if (normalized === "warn") return "warning";
  return "info";
}

function shouldLog(level) {
  const configured = normalizeLevel(envValue("APP_LOG_LEVEL") || "INFO");
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[configured];
}

function jsonSafe(value) {
  if (value === null) return null;
  if (typeof value === "string") return redactSensitiveText(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, item]) => !isSensitiveKey(key) && item !== undefined)
        .map(([key, item]) => [key, jsonSafe(item)]),
    );
  }
  return String(value);
}

function currentRequestLogContext() {
  const context = globalThis.__organelleGetRequestLogContext?.();
  if (!context || typeof context !== "object") return {};
  return context;
}

function httpStatusToLogLevel(statusCode) {
  if (statusCode >= 500) return "error";
  if (statusCode >= 400) return "warning";
  return "info";
}

function logPathFromUrl(value) {
  if (!value) return "/";
  try {
    return new URL(String(value), "http://organelle.local").pathname || "/";
  } catch {
    return String(value).split("?")[0] || "/";
  }
}

function buildLogPayload({ level, logger, message, fields = {}, now = new Date() }) {
  const service = envValue("APP_LOG_SERVICE") || "organelle";
  const env = envValue("APP_ENV") || envValue("ENVIRONMENT");
  const version = envValue("APP_VERSION");
  const payload = {
    timestamp: now.toISOString(),
    status: level,
    level,
    logger,
    message: redactSensitiveText(message),
    service,
  };

  if (env) {
    payload.env = env;
  }
  if (version) {
    payload.version = version;
  }

  for (const [key, value] of Object.entries(currentRequestLogContext())) {
    if (isSensitiveKey(key) || value === undefined) continue;
    payload[key] = jsonSafe(value);
  }

  for (const [key, value] of Object.entries(fields)) {
    if (isSensitiveKey(key) || value === undefined) continue;
    payload[key] = jsonSafe(value);
  }

  return payload;
}

module.exports = {
  LEVEL_WEIGHT,
  SENSITIVE_SUBSTRINGS,
  buildLogPayload,
  envValue,
  httpStatusToLogLevel,
  isSensitiveKey,
  jsonSafe,
  logPathFromUrl,
  normalizeLevel,
  shouldLog,
};
