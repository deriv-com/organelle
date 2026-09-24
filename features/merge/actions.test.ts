import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRole = vi.fn();
const fetchPublishedEmployeeDetails = vi.fn();
const requireActor = vi.fn();
const getSandboxAccess = vi.fn();
const sandboxAccessWithSql = vi.fn();

vi.mock("@/features/auth/session", () => ({
  MERGE_ROLES: ["publisher", "admin", "publisher"],
  EDITOR_ROLES: ["editor", "publisher", "admin", "publisher"],
  requireRole: (...args: unknown[]) => requireRole(...args),
  requireActor: (...args: unknown[]) => requireActor(...args),
}));

vi.mock("@/features/sandbox/access", () => ({
  getSandboxAccess: (...args: unknown[]) => getSandboxAccess(...args),
  sandboxAccessWithSql: (...args: unknown[]) => sandboxAccessWithSql(...args),
}));

vi.mock("@/features/chart/tree-query", () => ({
  fetchPublishedTree: vi.fn(),
  fetchTree: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  withDbRetry: vi.fn(),
}));

vi.mock("@/features/sandbox/staged-employees", () => ({
  applyStagedEmployeeEdits: vi.fn(),
}));

vi.mock("./published-employee-details", () => ({
  fetchPublishedEmployeeDetails: (...args: unknown[]) =>
    fetchPublishedEmployeeDetails(...args),
}));

vi.mock("@/lib/app-logging", () => ({
  logActionError: vi.fn(),
  logActionRejected: vi.fn(),
  logActionResult: vi.fn(),
  logStart: () => 0,
}));

vi.mock("./engine", () => ({
  runMerge: vi.fn(),
}));

import {
  fetchPublishedTree,
  fetchTree,
  type TreeQueryRow,
} from "@/features/chart/tree-query";
import { applyStagedEmployeeEdits } from "@/features/sandbox/staged-employees";
import { withDbRetry } from "@/lib/db";
import { runMerge } from "./engine";
import { commitMerge, previewMerge, previewSync } from "./actions";
import { toQueryRows } from "./tree";
import type { MergeNode, MergeResult } from "./types";

const SANDBOX_ID = "11111111-1111-1111-1111-111111111111";
const LIVE_ID = "22222222-2222-2222-2222-222222222222";
const BASE_ID = "33333333-3333-3333-3333-333333333333";
const ROOT_ID = "44444444-4444-4444-4444-444444444444";
const MANAGER_A_ID = "55555555-5555-5555-5555-555555555555";
const MANAGER_B_ID = "66666666-6666-6666-6666-666666666666";
const MOVED_SEAT_ID = "77777777-7777-7777-7777-777777777777";
const NEW_HIRE_SEAT_ID = "88888888-8888-8888-8888-888888888888";
const STALE_SEAT_ID = "99999999-9999-9999-9999-999999999999";
const RESULTING_TREE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function seat(id: string, parentId: string, name: string): MergeNode {
  return {
    id,
    parentId,
    kind: "seat",
    sortOrder: 0,
    rowVersion: 1,
    name: null,
    jobTitle: name,
    positionLevel: null,
    isAssistant: false,
    leafGridColumns: 3,
    assignments: [
      {
        employeeAuthId: `${id.slice(0, 8)}-0000-4000-8000-000000000001`,
        isHost: true,
        isPrimary: true,
        displayName: name,
        displayTitle: name,
        email: `${id.slice(0, 8)}@example.com`,
        avatarUrl: null,
        officeLocation: "KL",
        status: "active",
        joiningDate: null,
      },
    ],
  };
}

const LIVE_NODES = [
  seat(ROOT_ID, "", "Publisher"),
  seat(MANAGER_A_ID, ROOT_ID, "Manager A"),
  seat(MANAGER_B_ID, ROOT_ID, "Manager B"),
  seat(MOVED_SEAT_ID, MANAGER_A_ID, "Moved employee"),
];

const MERGED_NODES = [
  ...LIVE_NODES.map((node) =>
    node.id === MOVED_SEAT_ID ? { ...node, parentId: MANAGER_B_ID } : node,
  ),
  seat(NEW_HIRE_SEAT_ID, MANAGER_A_ID, "New hire"),
];

function mergeResult(merged = MERGED_NODES): MergeResult {
  return {
    zeroDrift: false,
    drift: true,
    valid: true,
    changes: [],
    conflicts: [],
    unresolved: [],
    graphConflicts: [],
    counts: { moves: 1, edits: 0, creates: 1, deletes: 0, peers: 0 },
    tints: {
      added: [NEW_HIRE_SEAT_ID],
      removed: [],
      moved: [MOVED_SEAT_ID],
      edited: [],
    },
    merged,
    snapshot: {
      direction: "published",
      expectedLiveSeq: 2,
      expectedNodeVersions: {},
      nodes: [],
      assignments: [],
      employeeOverrides: [],
      logs: [],
    },
  };
}

function arrangeCommit(): void {
  requireRole.mockResolvedValue({
    ok: true,
    actor: {
      authId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      role: "publisher",
      email: "hr@example.com",
    },
  });
  vi.mocked(fetchTree).mockImplementation(async (id: string) => {
    if (id === SANDBOX_ID) {
      return {
        treeId: SANDBOX_ID,
        name: "Sandbox",
        kind: "sandbox",
        archived: false,
        ownerAuthId: "editor-1",
        versionSeq: null,
        forkedFromSeq: 1,
        forkedFromTreeId: BASE_ID,
        rows: toQueryRows(MERGED_NODES),
      };
    }
    if (id === BASE_ID) {
      return {
        treeId: BASE_ID,
        name: "Base",
        kind: "historical",
        archived: false,
        ownerAuthId: null,
        versionSeq: 1,
        forkedFromSeq: 0,
        forkedFromTreeId: null,
        rows: toQueryRows(LIVE_NODES),
      };
    }
    return null;
  });
  vi.mocked(fetchPublishedTree).mockResolvedValue({
    treeId: LIVE_ID,
    versionSeq: 2,
    publishedAt: null,
    rows: toQueryRows(LIVE_NODES),
  });
  vi.mocked(runMerge).mockReturnValue(mergeResult());
  vi.mocked(withDbRetry).mockResolvedValueOnce(0);
}

function commitArgs(changeReasonOverrides: Record<string, "promotion_change">) {
  return {
    sandboxTreeId: SANDBOX_ID,
    title: "Publish restructure",
    resolutions: { conflict: { choice: "use_sandbox" as const } },
    includedKeys: ["move", "create"],
    changeReasonOverrides,
    cachedAtSeq: 2,
  };
}
const EMPLOYEE_ID = "44444444-4444-4444-8444-444444444444";

const sandboxOverrideRow: TreeQueryRow = {
  node_id: "55555555-5555-4555-8555-555555555555",
  parent_node_id: null,
  node_type: "seat",
  sort_order: 0,
  row_version: 1,
  name: null,
  job_title: "Engineer",
  position_level: 4,
  is_assistant: false,
  leaf_grid_columns: 3,
  employee_auth_id: EMPLOYEE_ID,
  is_host: true,
  is_primary: true,
  full_name: "Global Employee",
  email: "global@example.com",
  employee_job_title: "Engineer",
  employee_avatar_url: null,
  office_location: "Kuala Lumpur",
  status: "active",
  joining_date: null,
  override_auth_id: EMPLOYEE_ID,
  override_node_id: "55555555-5555-4555-8555-555555555555",
  override_display_name: "Global Employee",
  override_display_title: "Engineer",
  override_avatar_url: null,
  override_office_location: "Dubai",
};

describe("previewMerge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPublishedEmployeeDetails.mockResolvedValue({});
  });

  it("denies an actor without owner or publisher publish access", async () => {
    requireActor.mockResolvedValueOnce({
      ok: true,
      actor: { authId: "viewer-1", role: "viewer", email: "v@example.com" },
    });
    getSandboxAccess.mockResolvedValueOnce({ canPublish: false });
    expect(await previewMerge(SANDBOX_ID)).toEqual({ error: "Not allowed" });
    expect(fetchTree).not.toHaveBeenCalled();
  });

  it("allows the sandbox owner and loads merge preview", async () => {
    requireActor.mockResolvedValueOnce({
      ok: true,
      actor: { authId: "editor-1", role: "editor", email: "e@example.com" },
    });
    getSandboxAccess.mockResolvedValueOnce({ canPublish: true });
    vi.mocked(fetchTree).mockImplementation(async (id: string) => {
      if (id === SANDBOX_ID) {
        return {
          treeId: SANDBOX_ID,
          name: "Sandbox",
          kind: "sandbox",
          archived: false,
          ownerAuthId: "editor-1",
          versionSeq: null,
          forkedFromSeq: 1,
          forkedFromTreeId: BASE_ID,
          rows: [sandboxOverrideRow],
        };
      }
      if (id === BASE_ID) {
        return {
          treeId: BASE_ID,
          name: "Base",
          kind: "historical",
          archived: false,
          ownerAuthId: null,
          versionSeq: 1,
          forkedFromSeq: 0,
          forkedFromTreeId: null,
          rows: [],
        };
      }
      return null;
    });
    vi.mocked(fetchPublishedTree).mockResolvedValue({
      treeId: LIVE_ID,
      versionSeq: 2,
      publishedAt: null,
      rows: [],
    });
    fetchPublishedEmployeeDetails.mockResolvedValue({
      [EMPLOYEE_ID]: {
        displayName: "Global Employee",
        displayTitle: "Engineer",
        avatarUrl: null,
        officeLocation: "Kuala Lumpur",
      },
    });
    vi.mocked(runMerge).mockReturnValue({
      zeroDrift: true,
      drift: false,
      valid: true,
      changes: [],
      conflicts: [],
      unresolved: [],
      graphConflicts: [],
      counts: { moves: 0, edits: 0, creates: 0, deletes: 0, peers: 0 },
      tints: { added: [], removed: [], moved: [], edited: [] },
      merged: [],
      snapshot: {
        direction: "published",
        expectedLiveSeq: 2,
        expectedNodeVersions: {},
        nodes: [],
        assignments: [],
        employeeOverrides: [],
        logs: [],
      },
    });

    const result = await previewMerge(SANDBOX_ID);
    expect(fetchPublishedEmployeeDetails).toHaveBeenCalledWith([EMPLOYEE_ID]);
    expect(vi.mocked(runMerge).mock.calls[0]?.[0].liveEmployeeDetails).toEqual({
      [EMPLOYEE_ID]: expect.objectContaining({ officeLocation: "Kuala Lumpur" }),
    });
    expect(getSandboxAccess).toHaveBeenCalledWith(
      SANDBOX_ID,
      expect.objectContaining({ authId: "editor-1" }),
    );
    expect(result).toMatchObject({ sandboxTreeId: SANDBOX_ID, zeroDrift: true });
  });
});

describe("previewSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("denies non-owners", async () => {
    requireRole.mockResolvedValueOnce({
      ok: true,
      actor: { authId: "other", role: "editor", email: "e@example.com" },
    });
    vi.mocked(fetchTree).mockResolvedValueOnce({
      treeId: SANDBOX_ID,
      name: "Sandbox",
      kind: "sandbox",
      archived: false,
      ownerAuthId: "editor-1",
      versionSeq: null,
      forkedFromSeq: 1,
      forkedFromTreeId: BASE_ID,
      rows: [],
    });
    expect(await previewSync(SANDBOX_ID)).toEqual({
      error: "Only the sandbox owner can do this",
    });
  });

  it("rejects when sandbox is already current with live", async () => {
    requireRole.mockResolvedValueOnce({
      ok: true,
      actor: { authId: "editor-1", role: "editor", email: "e@example.com" },
    });
    vi.mocked(fetchTree).mockImplementation(async (id: string) => {
      if (id === SANDBOX_ID) {
        return {
          treeId: SANDBOX_ID,
          name: "Sandbox",
          kind: "sandbox",
          archived: false,
          ownerAuthId: "editor-1",
          versionSeq: null,
          forkedFromSeq: 2,
          forkedFromTreeId: BASE_ID,
          rows: [],
        };
      }
      if (id === BASE_ID) {
        return {
          treeId: BASE_ID,
          name: "Base",
          kind: "historical",
          archived: false,
          ownerAuthId: null,
          versionSeq: 2,
          forkedFromSeq: 0,
          forkedFromTreeId: null,
          rows: [],
        };
      }
      return null;
    });
    vi.mocked(fetchPublishedTree).mockResolvedValue({
      treeId: LIVE_ID,
      versionSeq: 2,
      publishedAt: null,
      rows: [],
    });
    vi.mocked(runMerge).mockReturnValue({
      zeroDrift: true,
      drift: false,
      valid: true,
      changes: [],
      conflicts: [],
      unresolved: [],
      graphConflicts: [],
      counts: { moves: 0, edits: 0, creates: 0, deletes: 0, peers: 0 },
      tints: { added: [], removed: [], moved: [], edited: [] },
      merged: [],
      snapshot: {
        direction: "sandbox",
        expectedLiveSeq: 2,
        expectedNodeVersions: {},
        nodes: [],
        assignments: [],
        employeeOverrides: [],
        logs: [],
      },
    });
    expect(await previewSync(SANDBOX_ID)).toEqual({
      error: "Sandbox is already up to date with live",
    });
  });
});

describe("commitMerge change reason boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireActor.mockResolvedValue({
      ok: true,
      actor: { authId: "hr-1", role: "publisher", email: "hr@example.com" },
    });
    getSandboxAccess.mockResolvedValue({ canPublish: true });
    sandboxAccessWithSql.mockResolvedValue({ canPublish: true });
    arrangeCommit();
  });

  it.each([
    ["invalid reason", { [MOVED_SEAT_ID]: "manager_change" }],
    ["malformed node id", { forged: "promotion_change" }],
    ["stale node id", { [STALE_SEAT_ID]: "promotion_change" }],
    ["non-eligible recomputed type", { [NEW_HIRE_SEAT_ID]: "promotion_change" }],
  ])("rejects %s after recomputing the final merge", async (_label, overrides) => {
    const result = await commitMerge({
      ...commitArgs({}),
      changeReasonOverrides: overrides,
    } as Parameters<typeof commitMerge>[0]);

    expect(result).toEqual({
      ok: false,
      code: "error",
      reason: "One or more change reason selections are no longer valid",
    });
    expect(runMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        resolutions: { conflict: { choice: "use_sandbox" } },
        includedKeys: ["move", "create"],
      }),
    );
    expect(withDbRetry).toHaveBeenCalledTimes(1);
    expect(applyStagedEmployeeEdits).not.toHaveBeenCalled();
  });

  it("persists every prospective seat and stores automatic choices as JSON null", async () => {
    const json = vi.fn((value: unknown) => value);
    const tx = Object.assign(
      vi.fn(async (strings: TemplateStringsArray) => {
        const query = strings.join(" ");
        if (query.includes("select forked_from_seq")) {
          return [{ forked_from_seq: 1, archived_at: null }];
        }
        if (query.includes("insert into organelle.sandbox_merges")) {
          return [{ merge_id: "cccccccc-cccc-cccc-cccc-cccccccccccc" }];
        }
        if (query.includes("select organelle.apply_merge")) {
          return [{ apply_merge: RESULTING_TREE_ID }];
        }
        return [];
      }),
      { json },
    );
    const sql = {
      begin: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    vi.mocked(withDbRetry).mockImplementationOnce(async (operation) =>
      operation(sql as never),
    );

    const result = await commitMerge(
      commitArgs({ [MOVED_SEAT_ID]: "promotion_change" }),
    );

    expect(result).toEqual({ ok: true, resultingTreeId: RESULTING_TREE_ID });
    expect(applyStagedEmployeeEdits).toHaveBeenCalledWith(tx, SANDBOX_ID);
    expect(json).toHaveBeenLastCalledWith({
      [MOVED_SEAT_ID]: "promotion_change",
      [NEW_HIRE_SEAT_ID]: null,
    });
  });
});
