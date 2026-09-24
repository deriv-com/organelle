export type NodeVersion = {
  nodeId: string;
  rowVersion: number;
};

export type PersistResult =
  { ok: true; versions: NodeVersion[] } | { ok: false; reason: string };

export interface PersistOp<T> {
  nodeIds: string[];
  apply: (rows: T) => T;
  persist: () => Promise<PersistResult>;
  onAck?: () => void;
}

export interface PersistQueueHandlers<T> {
  getLastGood: () => T;
  setLastGood: (rows: T) => void;
  setRows: (rows: T) => void;
  mergeVersions: (versions: NodeVersion[]) => void;
  restoreFromLastGood: (rows: T) => void;
  onFail: (reason: string) => void;
}

export function createPersistQueue<T>(handlers: PersistQueueHandlers<T>) {
  const pending: PersistOp<T>[] = [];
  let pumping = false;

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (pending.length > 0) {
        const op = pending.shift()!;
        let result: PersistResult;
        try {
          result = await op.persist();
        } catch {
          pending.length = 0;
          const good = handlers.getLastGood();
          handlers.setRows(good);
          handlers.restoreFromLastGood(good);
          handlers.onFail("Couldn't save — try again");
          return;
        }
        if (!result.ok) {
          pending.length = 0;
          const good = handlers.getLastGood();
          handlers.setRows(good);
          handlers.restoreFromLastGood(good);
          handlers.onFail(result.reason);
          return;
        }
        handlers.setLastGood(op.apply(handlers.getLastGood()));
        handlers.mergeVersions(result.versions);
        op.onAck?.();
      }
    } finally {
      pumping = false;
      if (pending.length > 0) void pump();
    }
  }

  return {
    enqueue(op: PersistOp<T>) {
      pending.push(op);
      void pump();
    },
  };
}
