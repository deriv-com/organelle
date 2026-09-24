/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import {
  assignDeptColors,
  cardHtml,
  deptColor,
  escapeHtml,
  formatJoining,
  memberAuthIdFromTarget,
  tint,
} from "./card";
import type { ChartRow, SeatMember } from "./chart-row";

function member(overrides: Partial<SeatMember> = {}): SeatMember {
  return {
    authId: "e1",
    displayName: "Jane Doe",
    displayTitle: "Engineer",
    email: "jane@example.com",
    avatarUrl: null,
    officeLocation: "Dubai",
    status: "active",
    joiningDate: null,
    isHost: true,
    servingNoticeMuted: false,
    sourceName: "Jane Doe",
    sourceTitle: "Engineer",
    sourceAvatarUrl: null,
    overrideName: null,
    overrideTitle: null,
    overrideAvatarUrl: null,
    ...overrides,
  };
}

function seatRow(members: SeatMember[], overrides: Partial<ChartRow> = {}): ChartRow {
  return {
    id: "s1",
    parentId: "root",
    kind: "seat",
    sortOrder: 0,
    rowVersion: 1,
    members,
    ...overrides,
  };
}

const ctx = { dept: "Engineering", isRoot: false };

describe("escapeHtml", () => {
  it("escapes markup-significant characters", () => {
    expect(escapeHtml(`<img src=x onerror="alert('1')">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;",
    );
  });
});

describe("cardHtml", () => {
  it("escapes member fields (XSS guard)", () => {
    const html = cardHtml(
      seatRow([member({ displayName: '<script>alert("x")</script>' })]),
      ctx,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders a joining card dashed with the orange date row", () => {
    const html = cardHtml(
      seatRow([member({ status: "joining", joiningDate: "2026-09-04" })]),
      ctx,
    );
    expect(html).toContain("border-dashed");
    expect(html).toContain("Joining 4 Sep");
    expect(html).toContain("text-orange-500");
  });

  it("greys out a serving notice card while keeping it visible", () => {
    const html = cardHtml(
      seatRow([member({ status: "serving_notice", servingNoticeMuted: true })]),
      ctx,
    );
    expect(html).toContain('data-status="serving_notice"');
    expect(html).toContain("background:#f3f4f6");
    expect(html).toContain("opacity-55");
    expect(html).not.toContain("filter:grayscale");
    expect(html).toContain("Jane Doe");
  });

  it("keeps a Level 5+ serving notice card in its normal colours", () => {
    const html = cardHtml(
      seatRow([
        member({
          status: "serving_notice",
          positionLevel: 5,
          servingNoticeMuted: true,
        }),
      ]),
      ctx,
    );
    expect(html).toContain('data-status="serving_notice"');
    expect(html).not.toContain("background:#f3f4f6");
    expect(html).not.toContain("opacity-55");
    expect(html).toContain("Jane Doe");
  });

  it("renders a vacant seat as a dashed card without its title on the published chart", () => {
    const html = cardHtml(seatRow([], { jobTitle: "New position" }), ctx);
    expect(html).toContain("Vacant");
    expect(html).toContain("Vacant seat");
    expect(html).not.toContain("New position");
    expect(html).toContain("border-dashed");
  });

  it("shows the vacant seat title in sandbox", () => {
    const html = cardHtml(seatRow([], { jobTitle: "New position" }), {
      ...ctx,
      editable: true,
    });
    expect(html).toContain("New position");
  });

  it("renders a seat with name, avatar, and office — not job title", () => {
    const html = cardHtml(seatRow([member()]), ctx);
    expect(html).toContain("Jane Doe");
    expect(html).toContain("Dubai");
    expect(html).not.toContain("Engineer");
  });

  it("shows the seat job title on sandbox cards", () => {
    const html = cardHtml(seatRow([member()], { jobTitle: "Staff Engineer" }), {
      ...ctx,
      editable: true,
    });
    expect(html).toContain("Staff Engineer");
  });

  it("marks photo avatars non-draggable so native HTML drag cannot steal the pointer", () => {
    const html = cardHtml(
      seatRow([member({ avatarUrl: "https://cdn.example/a.png" })]),
      ctx,
    );
    expect(html).toContain('src="https://cdn.example/a.png"');
    expect(html).toContain('draggable="false"');
  });

  it("does not interpolate a javascript avatar URL into innerHTML", () => {
    const html = cardHtml(seatRow([member({ avatarUrl: "javascript:alert(1)" })]), ctx);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
  });

  it("renders peer seats as stacked full cards, no compact host tag", () => {
    const html = cardHtml(
      seatRow([
        member(),
        member({
          authId: "e2",
          displayName: "Peer Two",
          officeLocation: "Malta",
          isHost: false,
        }),
      ]),
      ctx,
    );
    expect(html).toContain("Jane Doe");
    expect(html).toContain("Peer Two");
    expect(html).toContain("Dubai");
    expect(html).toContain("Malta");
    expect(html).toContain('data-member-id="e1"');
    expect(html).toContain('data-member-id="e2"');
    expect(html).toContain("data-peer-stack");
    expect(html.match(/rounded-md border/g)?.length).toBe(3);
    expect(html).not.toContain("(host)");
    expect(html).not.toContain("data-peer-toggle");
    expect(html).not.toContain("Engineer");
  });

  it("reads the clicked member id from a stacked card", () => {
    document.body.innerHTML = `<div data-member-id="e2"><span class="name">Peer</span></div>`;
    const inner = document.querySelector(".name");
    expect(memberAuthIdFromTarget(inner)).toBe("e2");
    expect(memberAuthIdFromTarget(null)).toBeNull();
  });

  it("renders member grip handles only in editable mode", () => {
    const row = seatRow([
      member(),
      member({ authId: "e2", displayName: "Peer Two", isHost: false }),
    ]);
    expect(cardHtml(row, ctx)).not.toContain("data-member-drag");
    const html = cardHtml(row, { ...ctx, editable: true });
    expect(html).toContain('data-member-drag="e1"');
    expect(html).toContain('data-member-drag="e2"');
  });

  it("renders a header with name only (counts live on the chip)", () => {
    const html = cardHtml(
      {
        id: "h1",
        parentId: "root",
        kind: "header",
        sortOrder: 0,
        rowVersion: 1,
        name: "Engineering",
        members: [],
      },
      ctx,
    );
    expect(html).toContain("Engineering");
    expect(html).not.toContain("reports");
    expect(html).not.toContain("direct");
    expect(html).toContain("border:1px solid");
    expect(html).not.toContain("border-top");
  });

  it("gives the root a thicker colour bar", () => {
    expect(cardHtml(seatRow([member()]), { ...ctx, isRoot: true })).toContain("w-2");
    expect(cardHtml(seatRow([member()]), ctx)).toContain("w-1");
  });

  it("pins a saving banner to the bottom of the card when persist is in flight", () => {
    const html = cardHtml(seatRow([member()]), { ...ctx, saving: true });
    expect(html).toContain('data-saving="true"');
    expect(html).toContain("Saving");
    expect(html).toContain("bottom-0");
    expect(html).not.toContain("inset-0");
    expect(html).toContain("Jane Doe");
    expect(html).not.toContain("<script>");
  });

  it("does not mark a card as saving by default", () => {
    expect(cardHtml(seatRow([member()]), ctx)).not.toContain("data-saving");
  });
});

describe("deptColor", () => {
  it("looks up the assigned colour and is neutral without an id", () => {
    const colors = assignDeptColors(["eng", "fin"]);
    expect(deptColor("eng", colors)).toBe(colors.get("eng"));
    expect(deptColor("eng", colors)).not.toBe(deptColor("fin", colors));
    expect(deptColor(null, colors)).toBe("#6b7280");
    expect(deptColor("missing", colors)).toBe("#6b7280");
  });
});

describe("assignDeptColors", () => {
  it("gives each id a unique colour while the palette has room", () => {
    const ids = Array.from({ length: 24 }, (_, i) => `d${i}`);
    const colors = assignDeptColors(ids);
    const hexes = ids.map((id) => colors.get(id)!);
    expect(new Set(hexes).size).toBe(24);
  });

  it("is a pure function of the id set", () => {
    const ids = ["b", "a", "c"];
    expect([...assignDeptColors(ids)]).toEqual([...assignDeptColors(["c", "a", "b"])]);
  });

  it("wraps after the palette is exhausted", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `d${i}`);
    const colors = assignDeptColors(ids);
    expect(new Set([...colors.values()]).size).toBe(24);
  });

  it("keeps 14 department fills distinct after the header tint", () => {
    const ids = Array.from({ length: 14 }, (_, i) => `d${i}`);
    const colors = assignDeptColors(ids);
    const fills = ids.map((id) => tint(colors.get(id)!, 0.76));
    expect(new Set(fills).size).toBe(14);
  });
});

describe("formatJoining", () => {
  it("formats ISO dates as 'Joining D MMM'", () => {
    expect(formatJoining("2026-01-04")).toBe("Joining 4 Jan");
  });

  it("never crashes on non-string input (postgres date objects, null)", () => {
    expect(formatJoining(new Date("2026-01-04") as unknown as string)).toBe(
      "Joining soon",
    );
    expect(formatJoining(null as unknown as string)).toBe("Joining soon");
    expect(formatJoining("garbage")).toBe("Joining soon");
  });
});
