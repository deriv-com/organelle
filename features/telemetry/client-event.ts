import { logPathFromUrl } from "@/lib/app-logging";

export const CLIENT_EVENT_TYPES = [
  "window_error",
  "unhandled_rejection",
  "resource_error",
  "route_error",
  "global_error",
  "chunk_load_error",
  "chart_limit",
] as const;

export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export const CLIENT_EVENT_MAX_BYTES = 8 * 1024;
export const CLIENT_EVENT_MAX_MESSAGE = 500;
export const CLIENT_EVENT_MAX_STACK = 4000;

const ALLOWED_KEYS = new Set(["type", "message", "stack", "pathname"]);
const FORBIDDEN_KEYS = new Set(["rows", "body", "token", "metadata"]);

export type SanitizedClientEvent = {
  type: ClientEventType;
  message: string;
  stack: string;
  pathname: string;
};

export type ParseClientEventResult =
  { ok: true; event: SanitizedClientEvent } | { ok: false; status: 400 | 413 };

function isClientEventType(value: unknown): value is ClientEventType {
  return (
    typeof value === "string" &&
    (CLIENT_EVENT_TYPES as readonly string[]).includes(value)
  );
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.slice(0, max);
}

export function parseClientEventBody(text: string): ParseClientEventResult {
  if (Buffer.byteLength(text, "utf8") > CLIENT_EVENT_MAX_BYTES) {
    return { ok: false, status: 413 };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, status: 400 };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, status: 400 };
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_KEYS.has(key) || !ALLOWED_KEYS.has(key)) {
      return { ok: false, status: 400 };
    }
  }
  if (!isClientEventType(record.type)) {
    return { ok: false, status: 400 };
  }
  return {
    ok: true,
    event: {
      type: record.type,
      message: clip(record.message, CLIENT_EVENT_MAX_MESSAGE),
      stack: clip(record.stack, CLIENT_EVENT_MAX_STACK),
      pathname: logPathFromUrl(
        typeof record.pathname === "string" ? record.pathname : "/",
      ),
    },
  };
}
