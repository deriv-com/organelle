import { describe, expect, it } from "vitest";

import { directoryRowBatches, encodeDirectoryStreamMessage } from "./directory-stream";
import { toPublicDirectoryRows, type DirectoryRow } from "./directory-row";

function row(nodeId: string): DirectoryRow {
  return {
    nodeId,
    host: {
      authId: nodeId,
      displayName: nodeId,
      displayTitle: "",
      email: "",
      avatarUrl: null,
      officeLocation: "",
      status: "active",
      joiningDate: null,
      isHost: true,
      sourceName: nodeId,
      sourceTitle: "",
      sourceAvatarUrl: null,
      overrideName: null,
      overrideTitle: null,
      overrideAvatarUrl: null,
    },
    jobTitle: "",
    teamPath: "",
    headerPathIds: [],
    manager: "",
    peers: 1,
    multiRole: false,
  };
}

describe("directory stream helpers", () => {
  it("splits ready directory rows into stable batches", () => {
    const rows = toPublicDirectoryRows([row("a"), row("b"), row("c")]);
    expect(
      directoryRowBatches(rows, 2).map((batch) => batch.map((r) => r.nodeId)),
    ).toEqual([["a", "b"], ["c"]]);
  });

  it("encodes messages as newline-delimited JSON", () => {
    expect(encodeDirectoryStreamMessage({ type: "done" })).toBe('{"type":"done"}\n');
  });

  it("does not serialize hidden fields for resigned directory rows", () => {
    const resigned = row("former");
    resigned.host.status = "resigned";
    resigned.host.displayTitle = "SECRET_DISPLAY_TITLE";
    resigned.host.sourceName = "SECRET_SAGE_NAME";
    resigned.host.sourceTitle = "SECRET_SAGE_TITLE";
    resigned.host.overrideName = "Former Employee";
    resigned.jobTitle = "SECRET_SEAT_TITLE";

    const encoded = encodeDirectoryStreamMessage({
      type: "rows",
      rows: toPublicDirectoryRows([resigned]),
    });

    expect(encoded).toContain('"status":"resigned"');
    expect(encoded).toContain('"displayName":"former"');
    expect(encoded).not.toContain("displayTitle");
    expect(encoded).not.toContain("sourceName");
    expect(encoded).not.toContain("overrideName");
    expect(encoded).not.toContain("jobTitle");
    expect(encoded).not.toContain("SECRET_");
  });
});
