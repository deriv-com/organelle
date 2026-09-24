import { describe, expect, it } from "vitest";

import type { ChartRow } from "./chart-row";
import {
  acknowledgePending,
  createPendingBuffers,
  type PendingCmd,
} from "./pending-commands";

function row(id: string): ChartRow {
  return { id, parentId: "", kind: "seat", sortOrder: 0, rowVersion: 1, members: [] };
}

function cmd(token: string, before: ChartRow[] = [row(token)]): PendingCmd {
  return {
    token,
    before,
    apply: (rows) => rows,
    nodeIds: [token],
    focusNodeId: token,
  };
}

describe("pending command buffers", () => {
  it("drops the exact command from both buffers when persistence succeeds", () => {
    const buffers = createPendingBuffers();
    buffers.pushUser(cmd("a"));
    buffers.pushUser(cmd("b"));
    buffers.acknowledge("a");
    expect(buffers.user().map((item) => item.token)).toEqual(["b"]);
    expect(buffers.snapshotCount()).toBe(1);
  });

  it("acknowledges a command that was moved to redo while persist was in flight", () => {
    const buffers = createPendingBuffers();
    buffers.pushUser(cmd("a"));
    const undone = buffers.popUser();
    expect(undone?.token).toBe("a");
    expect(buffers.redo()).toHaveLength(1);
    buffers.acknowledge("a");
    expect(buffers.user()).toEqual([]);
    expect(buffers.redo()).toEqual([]);
    expect(buffers.snapshotCount()).toBe(0);
  });

  it("lets redo restore a command until it is acknowledged", () => {
    const buffers = createPendingBuffers();
    buffers.pushUser(cmd("a"));
    buffers.popUser();
    buffers.popRedo();
    expect(buffers.user().map((item) => item.token)).toEqual(["a"]);
    buffers.acknowledge("a");
    expect(buffers.snapshotCount()).toBe(0);
  });

  it("clears both buffers on persist failure", () => {
    const buffers = createPendingBuffers();
    buffers.pushUser(cmd("a"));
    buffers.popUser();
    buffers.pushUser(cmd("b"));
    buffers.clear();
    expect(buffers.snapshotCount()).toBe(0);
  });

  it("retains zero snapshots after 100 sequential acknowledgements", () => {
    const buffers = createPendingBuffers();
    for (let i = 0; i < 100; i++) {
      const token = `cmd-${i}`;
      buffers.pushUser(cmd(token, [row(token)]));
      buffers.acknowledge(token);
    }
    expect(buffers.snapshotCount()).toBe(0);
    expect(buffers.user()).toEqual([]);
    expect(buffers.redo()).toEqual([]);
  });

  it("acknowledge is a no-op for an unknown token", () => {
    const buffers = createPendingBuffers();
    buffers.pushUser(cmd("a"));
    buffers.acknowledge("missing");
    expect(buffers.user()).toHaveLength(1);
  });
});

describe("acknowledgePending helper", () => {
  it("removes the token from both arrays without sharing the original references", () => {
    const user = [cmd("a"), cmd("b")];
    const redo = [cmd("a")];
    const nextUser = acknowledgePending(user, "a");
    const nextRedo = acknowledgePending(redo, "a");
    expect(nextUser.map((item) => item.token)).toEqual(["b"]);
    expect(nextRedo).toEqual([]);
    expect(user).toHaveLength(2);
  });
});
