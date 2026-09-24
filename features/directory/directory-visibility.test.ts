import { describe, expect, it } from "vitest";

import type { SeatMember } from "@/features/chart/chart-row";
import { resignedDirectoryRow } from "./directory-row";
import { filterDirectoryRowsForRole, mergeResignedRows } from "./directory-visibility";

function host(authId: string, status: SeatMember["status"]): SeatMember {
  return {
    authId,
    displayName: authId,
    displayTitle: "",
    email: `${authId}@example.com`,
    avatarUrl: null,
    officeLocation: "",
    status,
    joiningDate: null,
    isHost: true,
    sourceName: authId,
    sourceTitle: "",
    sourceAvatarUrl: null,
    overrideName: null,
    overrideTitle: null,
    overrideAvatarUrl: null,
  };
}

describe("directory role visibility", () => {
  const seated = resignedDirectoryRow(host("amy", "active"), "Eng");
  seated.nodeId = "seat-1";
  const gone = resignedDirectoryRow(host("pat", "resigned"), "Legal");

  it("hides resigned rows from viewers and editors", () => {
    const rows = [seated, gone];
    expect(
      filterDirectoryRowsForRole(rows, "viewer").map((r) => r.host.authId),
    ).toEqual(["amy"]);
    expect(
      filterDirectoryRowsForRole(rows, "editor").map((r) => r.host.authId),
    ).toEqual(["amy"]);
    expect(
      filterDirectoryRowsForRole(rows, "publisher").map((r) => r.host.authId),
    ).toEqual(["amy", "pat"]);
  });

  it("does not duplicate a resigned person who still has a seat", () => {
    const stillSeated = resignedDirectoryRow(host("pat", "resigned"), "Legal");
    stillSeated.nodeId = "seat-2";
    expect(mergeResignedRows([stillSeated], [gone]).map((r) => r.nodeId)).toEqual([
      "seat-2",
    ]);
  });
});
