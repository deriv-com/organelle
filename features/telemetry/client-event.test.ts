import { describe, expect, it } from "vitest";

import {
  CLIENT_EVENT_MAX_BYTES,
  CLIENT_EVENT_MAX_MESSAGE,
  CLIENT_EVENT_MAX_STACK,
  CLIENT_EVENT_TYPES,
  parseClientEventBody,
} from "./client-event";

describe("parseClientEventBody", () => {
  it("accepts an allowlisted event and strips query strings", () => {
    const result = parseClientEventBody(
      JSON.stringify({
        type: "window_error",
        message: "boom",
        stack: "Error: boom\n    at x",
        pathname: "/chart?focus=secret",
      }),
    );
    expect(result).toEqual({
      ok: true,
      event: {
        type: "window_error",
        message: "boom",
        stack: "Error: boom\n    at x",
        pathname: "/chart",
      },
    });
  });

  it("rejects payloads larger than 8 KB", () => {
    const result = parseClientEventBody("x".repeat(CLIENT_EVENT_MAX_BYTES + 1));
    expect(result).toEqual({ ok: false, status: 413 });
  });

  it("rejects unknown types and extra keys", () => {
    expect(parseClientEventBody(JSON.stringify({ type: "xss" })).ok).toBe(false);
    expect(
      parseClientEventBody(
        JSON.stringify({ type: "window_error", rows: [{ id: "n1" }] }),
      ),
    ).toEqual({ ok: false, status: 400 });
    expect(
      parseClientEventBody(JSON.stringify({ type: "window_error", body: "nope" })),
    ).toEqual({ ok: false, status: 400 });
    expect(
      parseClientEventBody(JSON.stringify({ type: "window_error", token: "abc" })),
    ).toEqual({ ok: false, status: 400 });
    expect(
      parseClientEventBody(JSON.stringify({ type: "window_error", metadata: {} })),
    ).toEqual({ ok: false, status: 400 });
  });

  it("truncates message and stack", () => {
    const result = parseClientEventBody(
      JSON.stringify({
        type: "unhandled_rejection",
        message: "m".repeat(CLIENT_EVENT_MAX_MESSAGE + 20),
        stack: "s".repeat(CLIENT_EVENT_MAX_STACK + 20),
        pathname: "/directory",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.message).toHaveLength(CLIENT_EVENT_MAX_MESSAGE);
    expect(result.event.stack).toHaveLength(CLIENT_EVENT_MAX_STACK);
  });

  it("accepts every allowlisted type", () => {
    for (const type of CLIENT_EVENT_TYPES) {
      const result = parseClientEventBody(JSON.stringify({ type, pathname: "/chart" }));
      expect(result.ok).toBe(true);
    }
  });

  it("rejects invalid JSON", () => {
    expect(parseClientEventBody("{")).toEqual({ ok: false, status: 400 });
  });
});
