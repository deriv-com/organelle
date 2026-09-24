import { describe, expect, it, vi } from "vitest";

import { createPersistQueue, type PersistResult } from "./persist-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("createPersistQueue", () => {
  it("runs persists FIFO, one at a time, and advances lastGood on ack", async () => {
    const first = deferred<PersistResult>();
    const second = deferred<PersistResult>();
    let lastGood = "base";
    let rows = "base";
    const order: string[] = [];
    const versions: number[][] = [];
    const setRows = vi.fn((next: string) => {
      rows = next;
    });

    const queue = createPersistQueue<string>({
      getLastGood: () => lastGood,
      setLastGood: (next) => {
        lastGood = next;
      },
      setRows,
      mergeVersions: (list) => {
        versions.push(list.map((v) => v.rowVersion));
      },
      restoreFromLastGood: (good) => {
        rows = good;
      },
      onFail: () => {
        order.push("fail");
      },
    });

    queue.enqueue({
      nodeIds: ["a"],
      apply: (current) => `${current}+a`,
      persist: async () => {
        order.push("persist-a");
        return first.promise;
      },
    });
    queue.enqueue({
      nodeIds: ["b"],
      apply: (current) => `${current}+b`,
      persist: async () => {
        order.push("persist-b");
        return second.promise;
      },
    });

    await Promise.resolve();
    expect(order).toEqual(["persist-a"]);

    first.resolve({ ok: true, versions: [{ nodeId: "a", rowVersion: 2 }] });
    await vi.waitFor(() => {
      expect(lastGood).toBe("base+a");
      expect(order).toContain("persist-b");
    });
    expect(order).toEqual(["persist-a", "persist-b"]);

    second.resolve({ ok: true, versions: [{ nodeId: "b", rowVersion: 3 }] });
    await vi.waitFor(() => {
      expect(lastGood).toBe("base+a+b");
    });
    expect(versions).toEqual([[2], [3]]);
    expect(rows).toBe("base");
    expect(setRows).not.toHaveBeenCalled();
  });

  it("calls onAck after a successful persist", async () => {
    const first = deferred<PersistResult>();
    const acked: string[] = [];
    const queue = createPersistQueue<string>({
      getLastGood: () => "base",
      setLastGood: () => {},
      setRows: () => {},
      mergeVersions: () => {},
      restoreFromLastGood: () => {},
      onFail: () => {},
    });
    queue.enqueue({
      nodeIds: ["a"],
      apply: (current) => current,
      persist: async () => first.promise,
      onAck: () => acked.push("a"),
    });
    first.resolve({ ok: true, versions: [] });
    await vi.waitFor(() => {
      expect(acked).toEqual(["a"]);
    });
  });

  it("on failure restores lastGood, drops the rest of the queue, and toasts", async () => {
    const first = deferred<PersistResult>();
    let lastGood = "base";
    let rows = "painted-a-then-b";
    let reason: string | null = null;
    const persistB = vi.fn(async (): Promise<PersistResult> => {
      return { ok: true, versions: [] };
    });
    const setRows = vi.fn((next: string) => {
      rows = next;
    });

    const queue = createPersistQueue<string>({
      getLastGood: () => lastGood,
      setLastGood: (next) => {
        lastGood = next;
      },
      setRows,
      mergeVersions: () => {},
      restoreFromLastGood: (good) => {
        rows = good;
      },
      onFail: (message) => {
        reason = message;
      },
    });

    queue.enqueue({
      nodeIds: ["a"],
      apply: (current) => `${current}+a`,
      persist: async () => first.promise,
    });
    queue.enqueue({
      nodeIds: ["b"],
      apply: (current) => `${current}+b`,
      persist: persistB,
    });

    first.resolve({ ok: false, reason: "Someone else moved this — reload" });
    await vi.waitFor(() => {
      expect(reason).toBe("Someone else moved this — reload");
    });
    expect(rows).toBe("base");
    expect(lastGood).toBe("base");
    expect(setRows).toHaveBeenCalledWith("base");
    expect(persistB).not.toHaveBeenCalled();
  });

  it("drops a queued undo when the preceding drop persist fails", async () => {
    const drop = deferred<PersistResult>();
    const undo = vi.fn(async (): Promise<PersistResult> => {
      return { ok: true, versions: [] };
    });
    let lastGood = "base";
    let rows = "painted-drop-then-undo";
    const queue = createPersistQueue<string>({
      getLastGood: () => lastGood,
      setLastGood: (next) => {
        lastGood = next;
      },
      setRows: (next) => {
        rows = next;
      },
      mergeVersions: () => {},
      restoreFromLastGood: (good) => {
        rows = good;
      },
      onFail: () => {},
    });
    queue.enqueue({
      nodeIds: ["n"],
      apply: (current) => `${current}+drop`,
      persist: async () => drop.promise,
    });
    queue.enqueue({
      nodeIds: ["n"],
      apply: (current) => current.replace("+drop", ""),
      persist: undo,
    });
    await Promise.resolve();
    drop.resolve({ ok: false, reason: "Couldn't save — try again" });
    await vi.waitFor(() => {
      expect(rows).toBe("base");
    });
    expect(undo).not.toHaveBeenCalled();
  });
});
