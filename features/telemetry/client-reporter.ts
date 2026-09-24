"use client";

import { logPathFromUrl } from "@/lib/app-logging";
import {
  CLIENT_EVENT_MAX_MESSAGE,
  CLIENT_EVENT_MAX_STACK,
  type ClientEventType,
} from "./client-event";

export const CHUNK_RELOAD_WINDOW_MS = 5 * 60 * 1000;
export const CLIENT_EVENT_DEDUP_MS = 30_000;

export type ReportClientEventInput = {
  type: ClientEventType;
  message?: string;
  stack?: string;
  pathname?: string;
};

const recent = new Map<string, number>();
let installed = false;

function clip(value: string | undefined, max: number): string {
  return (value ?? "").slice(0, max);
}

export function isChunkLoadFailure(message: string, name?: string): boolean {
  if (name === "ChunkLoadError") return true;
  return (
    /loading chunk \d+ failed/i.test(message) || /failed to load chunk/i.test(message)
  );
}

export function classifyStaticResource(
  url: string,
  origin: string,
): "chunk_load_error" | "resource_error" | null {
  let parsed: URL;
  try {
    parsed = new URL(url, origin);
  } catch {
    return null;
  }
  if (parsed.origin !== new URL(origin).origin) return null;
  if (!parsed.pathname.startsWith("/_next/static/")) return null;
  if (parsed.pathname.includes("/chunks/") || parsed.pathname.endsWith(".js")) {
    return "chunk_load_error";
  }
  return "resource_error";
}

export function shouldHardReload(
  pathname: string,
  now: number,
  storage: Pick<Storage, "getItem" | "setItem">,
): boolean {
  const key = `organelle:chunk-reload:${pathname}`;
  const previous = Number(storage.getItem(key) ?? "0");
  if (previous > 0 && now - previous < CHUNK_RELOAD_WINDOW_MS) return false;
  storage.setItem(key, String(now));
  return true;
}

export function reportClientEvent(event: ReportClientEventInput): void {
  if (typeof window === "undefined") return;
  const pathname = logPathFromUrl(event.pathname ?? window.location.pathname);
  const message = clip(event.message, CLIENT_EVENT_MAX_MESSAGE);
  const key = `${event.type}|${pathname}|${message}`;
  const now = Date.now();
  const last = recent.get(key);
  if (last !== undefined && now - last < CLIENT_EVENT_DEDUP_MS) return;
  recent.set(key, now);
  void fetch("/api/client-events", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: event.type,
      message,
      stack: clip(event.stack, CLIENT_EVENT_MAX_STACK),
      pathname,
    }),
  }).catch(() => {
    /* reporting must never throw */
  });
}

function currentPathname(): string {
  return logPathFromUrl(window.location.pathname);
}

function maybeReloadForChunk(): void {
  const pathname = currentPathname();
  try {
    if (!shouldHardReload(pathname, Date.now(), window.sessionStorage)) return;
  } catch {
    return;
  }
  window.location.reload();
}

function onWindowError(event: ErrorEvent): void {
  const resource = event.target;
  if (resource && resource !== window) {
    const element = resource as HTMLElement & { src?: string; href?: string };
    const url = element.src || element.href;
    if (typeof url === "string" && url) {
      const classified = classifyStaticResource(url, window.location.origin);
      if (classified) {
        reportClientEvent({
          type: classified,
          message: url,
          pathname: currentPathname(),
        });
        if (classified === "chunk_load_error") maybeReloadForChunk();
      }
      return;
    }
  }
  const message = event.message || "window error";
  const chunk = isChunkLoadFailure(message, event.error?.name);
  reportClientEvent({
    type: chunk ? "chunk_load_error" : "window_error",
    message,
    stack: event.error instanceof Error ? event.error.stack : undefined,
    pathname: currentPathname(),
  });
  if (chunk) maybeReloadForChunk();
}

function onUnhandledRejection(event: PromiseRejectionEvent): void {
  const reason = event.reason;
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "unhandled rejection";
  const stack = reason instanceof Error ? reason.stack : undefined;
  const chunk = isChunkLoadFailure(
    message,
    reason instanceof Error ? reason.name : undefined,
  );
  reportClientEvent({
    type: chunk ? "chunk_load_error" : "unhandled_rejection",
    message,
    stack,
    pathname: currentPathname(),
  });
  if (chunk) maybeReloadForChunk();
}

export function installClientReporter(): () => void {
  if (typeof window === "undefined" || installed) return () => {};
  installed = true;
  window.addEventListener("error", onWindowError, true);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    window.removeEventListener("error", onWindowError, true);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
    installed = false;
  };
}

export function resetClientReporterForTests(): void {
  recent.clear();
  installed = false;
}
