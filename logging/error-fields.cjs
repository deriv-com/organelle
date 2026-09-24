/* eslint-disable @typescript-eslint/no-require-imports */
const { redactSensitiveText } = require("./redaction.cjs");

const ERROR_EXTRA_KEYS = ["code", "severity_local", "severity", "errno"];

function readStringProperty(source, key) {
  if (!source || typeof source !== "object") return "";
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function readPrimitiveProperty(source, key) {
  if (!source || typeof source !== "object") return undefined;
  const value = source[key];
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return undefined;
}

function buildErrorLogFields(error) {
  if (error instanceof Error) {
    const fields = {
      "error.kind": error.name || error.constructor.name || "Error",
      "error.message": redactSensitiveText(error.message),
      "error.stack": error.stack ? redactSensitiveText(error.stack) : undefined,
    };
    const digest = readStringProperty(error, "digest");
    if (digest) fields.digest = digest;
    for (const key of ERROR_EXTRA_KEYS) {
      const value = readPrimitiveProperty(error, key);
      if (value !== undefined) fields[key] = value;
    }
    return fields;
  }

  return {
    "error.kind": typeof error,
    "error.message": redactSensitiveText(String(error)),
  };
}

module.exports = {
  ERROR_EXTRA_KEYS,
  buildErrorLogFields,
};
