import { describe, expect, it } from "vitest";

import { toPersistAck } from "./persist-ack";

describe("toPersistAck", () => {
  it("maps node_id / row_version and omits assignment columns", () => {
    const ack = toPersistAck([
      { node_id: "n1", row_version: 4 },
      { node_id: "n2", row_version: "5" },
    ]);
    expect(ack).toEqual({
      ok: true,
      versions: [
        { nodeId: "n1", rowVersion: 4 },
        { nodeId: "n2", rowVersion: 5 },
      ],
      commandId: null,
      canUndo: false,
      canRedo: false,
      undoFocusNodeId: null,
      redoFocusNodeId: null,
      undoLog: [],
      redoLog: [],
    });
    expect(ack).not.toHaveProperty("rows");
    expect(JSON.stringify(ack)).not.toContain("employee");
    expect(JSON.stringify(ack)).not.toContain("assignment");
  });
});
