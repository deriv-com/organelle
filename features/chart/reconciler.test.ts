import { describe, expect, it } from "vitest";

import type { ChartRow } from "./chart-row";
import { carryRenderState, classifyUpdate, patchLiveContent } from "./reconciler";

function row(id: string, overrides: Partial<ChartRow> = {}): ChartRow {
  return {
    id,
    parentId: "root",
    kind: "seat",
    sortOrder: 0,
    rowVersion: 1,
    leafGridColumns: 3,
    members: [],
    ...overrides,
  };
}

describe("classifyUpdate", () => {
  it("returns 'same' for identical content under a new array reference", () => {
    const a = [row("x"), row("y")];
    const b = [row("x"), row("y")];
    expect(classifyUpdate(a, b, { treeChanged: false })).toBe("same");
  });

  it("returns 'content' when only member fields change", () => {
    const a = [row("x")];
    const b = [
      row("x", {
        members: [
          {
            authId: "e1",
            displayName: "New Name",
            displayTitle: "T",
            email: "n@example.com",
            avatarUrl: null,
            officeLocation: "",
            status: "active",
            joiningDate: null,
            isHost: true,
            sourceName: "New Name",
            sourceTitle: "T",
            sourceAvatarUrl: null,
            overrideName: null,
            overrideTitle: null,
            overrideAvatarUrl: null,
          },
        ],
      }),
    ];
    expect(classifyUpdate(a, b, { treeChanged: false })).toBe("content");
  });

  it("returns 'content' when serving-notice level styling changes", () => {
    const noticeMember = {
      authId: "e1",
      displayName: "Notice Employee",
      displayTitle: "Lead",
      email: "notice@example.com",
      avatarUrl: null,
      officeLocation: "Dubai",
      status: "serving_notice" as const,
      joiningDate: null,
      isHost: true,
      sourceName: "Notice Employee",
      sourceTitle: "Lead",
      sourceAvatarUrl: null,
      overrideName: null,
      overrideTitle: null,
      overrideAvatarUrl: null,
      positionLevel: 4,
      servingNoticeMuted: true,
    };
    const before = [row("x", { members: [noticeMember] })];
    const after = [
      row("x", {
        members: [
          {
            ...noticeMember,
            positionLevel: 5,
            servingNoticeMuted: false,
          },
        ],
      }),
    ];

    expect(classifyUpdate(before, after, { treeChanged: false })).toBe("content");
  });

  it("returns 'structural-preserving' for reparent, reorder, add, remove", () => {
    const base = [row("x"), row("y")];
    expect(
      classifyUpdate(base, [row("x"), row("y", { parentId: "other" })], {
        treeChanged: false,
      }),
    ).toBe("structural-preserving");
    expect(
      classifyUpdate(base, [row("x"), row("y", { sortOrder: 3 })], {
        treeChanged: false,
      }),
    ).toBe("structural-preserving");
    expect(
      classifyUpdate(base, [row("x"), row("y"), row("z")], { treeChanged: false }),
    ).toBe("structural-preserving");
    expect(classifyUpdate(base, [row("x")], { treeChanged: false })).toBe(
      "structural-preserving",
    );
  });

  it("returns 'structural-refit' when the tree changed", () => {
    expect(classifyUpdate([row("x")], [row("x")], { treeChanged: true })).toBe(
      "structural-refit",
    );
  });

  it("returns 'structural-preserving' when isAssistant toggles", () => {
    const base = [row("parent", { parentId: "" }), row("kid")];
    expect(
      classifyUpdate(
        base,
        [row("parent", { parentId: "" }), row("kid", { isAssistant: true })],
        {
          treeChanged: false,
        },
      ),
    ).toBe("structural-preserving");
    expect(
      classifyUpdate(
        [row("parent", { parentId: "" }), row("kid", { isAssistant: true })],
        [row("parent", { parentId: "" }), row("kid")],
        { treeChanged: false },
      ),
    ).toBe("structural-preserving");
  });

  it("returns 'structural-preserving' when leafGridColumns changes", () => {
    const base = [row("parent", { parentId: "" }), row("kid")];
    expect(
      classifyUpdate(
        base,
        [row("parent", { parentId: "", leafGridColumns: 4 }), row("kid")],
        {
          treeChanged: false,
        },
      ),
    ).toBe("structural-preserving");
  });

  it("returns 'content' when isAssistant is unchanged and only members change", () => {
    const member = {
      authId: "e1",
      displayName: "New Name",
      displayTitle: "T",
      email: "n@example.com",
      avatarUrl: null,
      officeLocation: "",
      status: "active" as const,
      joiningDate: null,
      isHost: true,
      sourceName: "New Name",
      sourceTitle: "T",
      sourceAvatarUrl: null,
      overrideName: null,
      overrideTitle: null,
      overrideAvatarUrl: null,
    };
    const a = [row("kid", { isAssistant: true, members: [] })];
    const b = [row("kid", { isAssistant: true, members: [member] })];
    expect(classifyUpdate(a, b, { treeChanged: false })).toBe("content");
  });
});

describe("carryRenderState", () => {
  it("copies exactly _expanded and _pagingStep, matched by node_id", () => {
    const oldRows = [row("x", { _expanded: false, _pagingStep: 60 })];
    const newRows = [row("x"), row("new")];
    carryRenderState(oldRows, newRows);
    expect(newRows[0]!._expanded).toBe(false);
    expect(newRows[0]!._pagingStep).toBe(60);
    expect(newRows[1]!._expanded).toBeUndefined();
  });
});

describe("patchLiveContent", () => {
  it("copies name, jobTitle, and members onto the live object", () => {
    const live = row("x", { name: "Old", jobTitle: "Engineer" });
    const members = [
      {
        authId: "e1",
        displayName: "Ada",
        displayTitle: "Lead",
        email: "ada@example.com",
        avatarUrl: null,
        officeLocation: "",
        status: "active" as const,
        joiningDate: null,
        isHost: true,
        sourceName: "Ada",
        sourceTitle: "Lead",
        sourceAvatarUrl: null,
        overrideName: null,
        overrideTitle: null,
        overrideAvatarUrl: null,
      },
    ];
    patchLiveContent(live, row("x", { name: "New", jobTitle: "Director", members }));
    expect(live.name).toBe("New");
    expect(live.jobTitle).toBe("Director");
    expect(live.members).toBe(members);
  });

  it("leaves classifyUpdate at content for a header rename", () => {
    const prev = [row("h", { kind: "header", name: "Old", parentId: "" })];
    const next = [row("h", { kind: "header", name: "New", parentId: "" })];
    expect(classifyUpdate(prev, next, { treeChanged: false })).toBe("content");
    patchLiveContent(prev[0]!, next[0]!);
    expect(prev[0]!.name).toBe("New");
  });
});
