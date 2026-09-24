import { describe, expect, it } from "vitest";

import type { ChartRow, SeatMember } from "../chart-row";
import { chipText } from "./chip";

function member(displayName: string): SeatMember {
  return {
    authId: displayName,
    displayName,
    displayTitle: "",
    email: "",
    avatarUrl: null,
    officeLocation: "",
    status: "active",
    joiningDate: null,
    isHost: true,
    sourceName: displayName,
    sourceTitle: "",
    sourceAvatarUrl: null,
    overrideName: null,
    overrideTitle: null,
    overrideAvatarUrl: null,
  };
}

function seat(id: string, name: string): ChartRow {
  return {
    id,
    parentId: "root",
    kind: "seat",
    sortOrder: 0,
    rowVersion: 1,
    members: [member(name)],
  };
}

function header(id: string, name: string): ChartRow {
  return {
    id,
    parentId: "root",
    kind: "header",
    sortOrder: 0,
    rowVersion: 1,
    name,
    members: [],
  };
}

describe("chipText", () => {
  it("names sibling insert before/after the target", () => {
    const from = seat("a", "Ahmad");
    const to = seat("b", "Riley Fixture");
    expect(chipText({ zone: "sibling-before" }, true, null, from, to)).toBe(
      "Place Ahmad before Riley Fixture",
    );
    expect(chipText({ zone: "sibling-after" }, true, null, from, to)).toBe(
      "Place Ahmad after Riley Fixture",
    );
  });

  it("uses the dragged member name on a sibling gap", () => {
    const from = seat("a", "Host");
    from.members.push(member("Ahmad"));
    const to = header("h", "Finance");
    expect(chipText({ zone: "sibling-before" }, true, null, from, to, "Ahmad")).toBe(
      "Place Ahmad before Finance",
    );
  });

  it("keeps child and peer copy", () => {
    const from = header("c", "Compliance");
    const to = header("f", "Finance");
    expect(chipText({ zone: "child" }, true, null, from, to)).toBe(
      "Move Compliance under Finance",
    );
    expect(
      chipText({ zone: "peer" }, true, null, seat("a", "Ahmad"), seat("b", "Riley")),
    ).toBe("Move Ahmad as peer of Riley");
  });
});
