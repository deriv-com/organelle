import { redactSensitiveText } from "./redaction";

const ERROR_EXTRA_KEYS = ["code", "severity_local", "severity", "errno"] as const;

function readStringProperty(source: object, key: string): string {
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function readPrimitiveProperty(
  source: object,
  key: string,
): string | number | boolean | undefined {
  const value = (source as Record<string, unknown>)[key];
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return undefined;
}

export function buildErrorLogFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const fields: Record<string, unknown> = {
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
