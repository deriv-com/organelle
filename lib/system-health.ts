import { hostname as osHostname } from "node:os";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

import { logEvent, type AppLogLevel } from "@/lib/app-logging";

export const SYSTEM_HEALTH_INTERVAL_MS = 5 * 60 * 1000;
export const RSS_ERROR_BYTES = 3 * 1024 * 1024 * 1024;
export const EVENT_LOOP_LAG_ERROR_MS = 1_000;

const REGISTERED = Symbol.for("organelle.system.health");

type OrganelleHealthGlobal = typeof globalThis & {
  [REGISTERED]?: { timer: NodeJS.Timeout; histogram?: IntervalHistogram };
};

export type SystemHealthSnapshot = {
  logger: "system.health";
  level: AppLogLevel;
  message: string;
  fields: {
    rss_bytes: number;
    heap_used_bytes: number;
    heap_total_bytes: number;
    external_bytes: number;
    memory_heap_used_ratio: number;
    event_loop_lag_p95_ms: number;
    uptime_s: number;
    host: string;
    health_status: "healthy" | "unhealthy";
    failure_reason?: "rss_high" | "event_loop_lag_high";
  };
};

export type SystemHealthDeps = {
  memoryUsage?: () => NodeJS.MemoryUsage;
  hostname?: () => string;
  uptime?: () => number;
  eventLoopLagP95Ms?: () => number;
  log?: typeof logEvent;
  setIntervalFn?: typeof setInterval;
};

function ratio(used: number, total: number): number {
  if (total <= 0) return 0;
  return Number((used / total).toFixed(4));
}

function unhealthyReason(
  memory: NodeJS.MemoryUsage,
  eventLoopLagP95Ms: number,
): SystemHealthSnapshot["fields"]["failure_reason"] {
  if (memory.rss >= RSS_ERROR_BYTES) return "rss_high";
  if (eventLoopLagP95Ms >= EVENT_LOOP_LAG_ERROR_MS) return "event_loop_lag_high";
  return undefined;
}

export function collectSystemHealthSnapshot(
  deps: SystemHealthDeps = {},
): SystemHealthSnapshot {
  const memory = (deps.memoryUsage ?? process.memoryUsage)();
  const heapRatio = ratio(memory.heapUsed, memory.heapTotal);
  const lag = deps.eventLoopLagP95Ms?.() ?? 0;
  const failureReason = unhealthyReason(memory, lag);
  const healthStatus = failureReason ? "unhealthy" : "healthy";
  const level: AppLogLevel = failureReason ? "error" : "info";
  return {
    logger: "system.health",
    level,
    message: "Process health",
    fields: {
      rss_bytes: memory.rss,
      heap_used_bytes: memory.heapUsed,
      heap_total_bytes: memory.heapTotal,
      external_bytes: memory.external,
      memory_heap_used_ratio: heapRatio,
      event_loop_lag_p95_ms: lag,
      uptime_s: Number((deps.uptime ?? process.uptime)().toFixed(1)),
      host: (deps.hostname ?? osHostname)(),
      health_status: healthStatus,
      failure_reason: failureReason,
    },
  };
}

function emitHealth(deps: SystemHealthDeps, histogram?: IntervalHistogram): void {
  const lagFromHistogram = (): number => {
    if (!histogram) return 0;
    try {
      return Number((histogram.percentile(95) / 1e6).toFixed(2));
    } catch {
      return 0;
    }
  };
  const snapshot = collectSystemHealthSnapshot({
    ...deps,
    eventLoopLagP95Ms: deps.eventLoopLagP95Ms ?? lagFromHistogram,
  });
  if (snapshot.fields.health_status === "healthy") {
    histogram?.reset();
    return;
  }
  (deps.log ?? logEvent)({
    level: snapshot.level,
    logger: snapshot.logger,
    message: snapshot.message,
    fields: snapshot.fields,
  });
  histogram?.reset();
}

export function registerSystemHealthLogs(deps: SystemHealthDeps = {}): void {
  const global = globalThis as OrganelleHealthGlobal;
  if (global[REGISTERED]) return;

  const histogram = deps.eventLoopLagP95Ms
    ? undefined
    : monitorEventLoopDelay({ resolution: 20 });
  histogram?.enable();
  const delayHistogram = histogram as
    (IntervalHistogram & { unref?: () => void }) | undefined;
  delayHistogram?.unref?.();

  emitHealth(deps, histogram);

  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const timer = setIntervalFn(
    () => emitHealth(deps, histogram),
    SYSTEM_HEALTH_INTERVAL_MS,
  ) as NodeJS.Timeout;
  timer.unref?.();
  global[REGISTERED] = { timer, histogram };
}

export function resetSystemHealthForTests(): void {
  const global = globalThis as OrganelleHealthGlobal;
  const registered = global[REGISTERED];
  if (!registered) return;
  clearInterval(registered.timer);
  registered.histogram?.disable();
  delete global[REGISTERED];
}
