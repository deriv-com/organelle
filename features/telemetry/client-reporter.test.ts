/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHUNK_RELOAD_WINDOW_MS,
  classifyStaticResource,
  isChunkLoadFailure,
  reportClientEvent,
  resetClientReporterForTests,
  shouldHardReload,
} from "./client-reporter";

describe("isChunkLoadFailure", () => {
  it("recognizes Next.js chunk errors", () => {
    expect(isChunkLoadFailure("Loading chunk 123 failed", "ChunkLoadError")).toBe(true);
    expect(isChunkLoadFailure("Failed to load resource", "Error")).toBe(false);
  });
});

describe("classifyStaticResource", () => {
  it("classifies same-origin Next static scripts as chunk_load_error", () => {
    expect(
      classifyStaticResource(
        "https://organelle.example.com/_next/static/chunks/app/chart.js",
        "https://organelle.example.com",
      ),
    ).toBe("chunk_load_error");
  });

  it("classifies same-origin Next CSS as resource_error", () => {
    expect(
      classifyStaticResource(
        "https://organelle.example.com/_next/static/css/app.css",
        "https://organelle.example.com",
      ),
    ).toBe("resource_error");
  });

  it("ignores cross-origin and non-static URLs", () => {
    expect(
      classifyStaticResource(
        "https://cdn.example/_next/static/chunks/x.js",
        "https://organelle.example.com",
      ),
    ).toBeNull();
    expect(
      classifyStaticResource(
        "https://organelle.example.com/icon.png",
        "https://organelle.example.com",
      ),
    ).toBeNull();
  });
});

describe("shouldHardReload", () => {
  it("allows one reload per pathname within five minutes, then blocks", () => {
    const storage = new Map<string, string>();
    const fake: Pick<Storage, "getItem" | "setItem"> = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
    };
    expect(shouldHardReload("/chart", 1_000, fake)).toBe(true);
    expect(shouldHardReload("/chart", 1_000 + CHUNK_RELOAD_WINDOW_MS - 1, fake)).toBe(
      false,
    );
    expect(shouldHardReload("/directory", 1_000, fake)).toBe(true);
    expect(shouldHardReload("/chart", 1_000 + CHUNK_RELOAD_WINDOW_MS, fake)).toBe(true);
  });
});

describe("reportClientEvent", () => {
  beforeEach(() => {
    resetClientReporterForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
  });

  afterEach(() => {
    resetClientReporterForTests();
    vi.unstubAllGlobals();
  });

  it("posts a sanitized event and dedupes identical reports for 30 seconds", () => {
    reportClientEvent({
      type: "window_error",
      message: "boom",
      pathname: "/chart?x=1",
    });
    reportClientEvent({
      type: "window_error",
      message: "boom",
      pathname: "/chart?x=1",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("/api/client-events");
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(String(init.body))).toMatchObject({
      type: "window_error",
      message: "boom",
      pathname: "/chart",
    });
  });
});
