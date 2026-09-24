import { describe, expect, it } from "vitest";

import type { ChartRow, SeatMember } from "./chart-row";
import {
  canEditPersonFields,
  isFirstSeatForPerson,
  primaryDenorm,
  restorePrimaries,
  seatChrome,
  showHostBadge,
} from "./primary-seat";

function member(authId: string, extra: Partial<SeatMember> = {}): SeatMember {
  return {
    authId,
    displayName: authId,
    displayTitle: "",
    email: "",
    avatarUrl: null,
    officeLocation: "",
    status: "active",
    joiningDate: null,
    isHost: true,
    sourceName: authId,
    sourceTitle: "",
    sourceAvatarUrl: null,
    overrideName: null,
    overrideTitle: null,
    overrideAvatarUrl: null,
    ...extra,
  };
}

function row(
  id: string,
  parentId: string,
  kind: "header" | "seat",
  extras: Partial<ChartRow> = {},
): ChartRow {
  return {
    id,
    parentId,
    kind,
    sortOrder: 0,
    rowVersion: 1,
    members: [],
    ...extras,
  };
}

describe("seat chrome", () => {
  it("hides Host on a solo seat", () => {
    expect(showHostBadge(1)).toBe(false);
    expect(
      seatChrome({
        personSeatCount: 1,
        seatMemberCount: 1,
        isPrimary: true,
        isHost: true,
      }),
    ).toEqual({});
  });

  it("shows Host/Peer only when the seat has 2+ members", () => {
    expect(
      seatChrome({
        personSeatCount: 1,
        seatMemberCount: 2,
        isPrimary: true,
        isHost: true,
      }),
    ).toEqual({ host: "Host" });
    expect(
      seatChrome({
        personSeatCount: 1,
        seatMemberCount: 2,
        isPrimary: true,
        isHost: false,
      }),
    ).toEqual({ host: "Peer" });
  });

  it("shows Primary/Secondary only when the person has 2+ seats", () => {
    expect(
      seatChrome({
        personSeatCount: 2,
        seatMemberCount: 1,
        isPrimary: true,
        isHost: true,
      }),
    ).toEqual({ primary: "Primary" });
    expect(
      seatChrome({
        personSeatCount: 2,
        seatMemberCount: 1,
        isPrimary: false,
        isHost: true,
      }),
    ).toEqual({ primary: "Secondary" });
  });
});

describe("drawer gating", () => {
  it("shows the edit form only in a sandbox the editor owns", () => {
    expect(canEditPersonFields({ treeKind: "published", canEdit: true })).toBe(false);
    expect(canEditPersonFields({ treeKind: "sandbox", canEdit: false })).toBe(false);
    expect(canEditPersonFields({ treeKind: "sandbox", canEdit: true })).toBe(true);
  });
});

describe("primary denormalize", () => {
  it("copies the ancestor-seat host and header path", () => {
    const rows = [
      row("root", "", "header", { name: "Company" }),
      row("eng", "root", "header", { name: "Engineering" }),
      row("mgr", "eng", "seat", { members: [member("manager", { isHost: true })] }),
      row("ic", "mgr", "seat", {
        jobTitle: "Engineer",
        members: [member("ada", { isPrimary: true })],
      }),
    ];
    expect(primaryDenorm(rows, "ic")).toEqual({
      managerAuthId: "manager",
      teamPath: "Company › Engineering",
    });
  });
});

describe("restorePrimaries", () => {
  it("promotes the remaining seat after the primary is deleted", () => {
    const rows = [
      row("root", "", "seat", { members: [member("publisher")] }),
      row("b", "root", "seat", { members: [member("ada", { isPrimary: false })] }),
    ];
    const next = restorePrimaries(rows);
    expect(next.find((r) => r.id === "b")!.members[0]!.isPrimary).toBe(true);
  });
});

describe("isFirstSeatForPerson", () => {
  it("is true only when the person has no seat yet", () => {
    const rows = [row("a", "", "seat", { members: [member("ada")] })];
    expect(isFirstSeatForPerson(rows, "ada")).toBe(false);
    expect(isFirstSeatForPerson(rows, "new")).toBe(true);
  });
});
