import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EVENT_LOOP_LAG_ERROR_MS,
  RSS_ERROR_BYTES,
  SYSTEM_HEALTH_INTERVAL_MS,
  collectSystemHealthSnapshot,
  registerSystemHealthLogs,
  resetSystemHealthForTests,
} from "./system-health";

describe("system health logs", () => {
  afterEach(() => {
    resetSystemHealthForTests();
    vi.restoreAllMocks();
  });

  it("emits the field names structured logging monitors query", () => {
    const snapshot = collectSystemHealthSnapshot({
      memoryUsage: () => ({
        rss: 100,
        heapTotal: 200,
        heapUsed: 50,
        external: 10,
        arrayBuffers: 0,
      }),
      hostname: () => "task-host",
      uptime: () => 12.5,
      eventLoopLagP95Ms: () => 3.25,
    });
    expect(snapshot.logger).toBe("system.health");
    expect(snapshot.level).toBe("info");
    expect(snapshot.fields).toMatchObject({
      rss_bytes: 100,
      heap_used_bytes: 50,
      heap_total_bytes: 200,
      external_bytes: 10,
      memory_heap_used_ratio: 0.25,
      event_loop_lag_p95_ms: 3.25,
      uptime_s: 12.5,
      host: "task-host",
      health_status: "healthy",
    });
  });

  it("keeps high heap ratio at info when the process is otherwise healthy", () => {
    const heap = collectSystemHealthSnapshot({
      memoryUsage: () => ({
        rss: 1,
        heapTotal: 100,
        heapUsed: 90,
        external: 0,
        arrayBuffers: 0,
      }),
      hostname: () => "h",
      uptime: () => 1,
      eventLoopLagP95Ms: () => 0,
    });
    expect(heap.level).toBe("info");
    expect(heap.fields.memory_heap_used_ratio).toBe(0.9);
    expect(heap.fields.health_status).toBe("healthy");
    expect(heap.fields.failure_reason).toBeUndefined();
  });

  it("errors when RSS or event loop lag is unhealthy", () => {
    const rss = collectSystemHealthSnapshot({
      memoryUsage: () => ({
        rss: RSS_ERROR_BYTES,
        heapTotal: 100,
        heapUsed: 10,
        external: 0,
        arrayBuffers: 0,
      }),
      hostname: () => "h",
      uptime: () => 1,
      eventLoopLagP95Ms: () => 0,
    });
    expect(RSS_ERROR_BYTES).toBe(3 * 1024 * 1024 * 1024);
    expect(rss.level).toBe("error");
    expect(rss.fields.health_status).toBe("unhealthy");
    expect(rss.fields.failure_reason).toBe("rss_high");

    const lag = collectSystemHealthSnapshot({
      memoryUsage: () => ({
        rss: 1,
        heapTotal: 100,
        heapUsed: 10,
        external: 0,
        arrayBuffers: 0,
      }),
      hostname: () => "h",
      uptime: () => 1,
      eventLoopLagP95Ms: () => EVENT_LOOP_LAG_ERROR_MS,
    });
    expect(lag.level).toBe("error");
    expect(lag.fields.health_status).toBe("unhealthy");
    expect(lag.fields.failure_reason).toBe("event_loop_lag_high");
  });

  it("registers one unref'd interval without emitting healthy logs", () => {
    const unref = vi.fn();
    const setIntervalFn = vi.fn(() => ({ unref }));
    const log = vi.fn();
    registerSystemHealthLogs({
      setIntervalFn: setIntervalFn as unknown as typeof setInterval,
      log,
      memoryUsage: () => ({
        rss: 1,
        heapTotal: 2,
        heapUsed: 1,
        external: 0,
        arrayBuffers: 0,
      }),
      hostname: () => "h",
      uptime: () => 1,
      eventLoopLagP95Ms: () => 0,
    });
    registerSystemHealthLogs({
      setIntervalFn: setIntervalFn as unknown as typeof setInterval,
      log,
    });
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(setIntervalFn).toHaveBeenCalledWith(
      expect.any(Function),
      SYSTEM_HEALTH_INTERVAL_MS,
    );
    expect(unref).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("emits an error log when registered health is unhealthy", () => {
    const unref = vi.fn();
    const setIntervalFn = vi.fn(() => ({ unref }));
    const log = vi.fn();
    registerSystemHealthLogs({
      setIntervalFn: setIntervalFn as unknown as typeof setInterval,
      log,
      memoryUsage: () => ({
        rss: RSS_ERROR_BYTES,
        heapTotal: 2,
        heapUsed: 1,
        external: 0,
        arrayBuffers: 0,
      }),
      hostname: () => "h",
      uptime: () => 1,
      eventLoopLagP95Ms: () => 0,
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toMatchObject({
      level: "error",
      logger: "system.health",
      fields: {
        health_status: "unhealthy",
        failure_reason: "rss_high",
      },
    });
  });
});
