import { beforeEach, describe, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => {
  const requireActor = vi.fn();
  const summaries: {
    commandId: string;
    kind: string;
    undoesCommandId: string | null;
    actorAuthId: string | null;
  }[] = [];
  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    const query = strings.join("?");
    if (query.includes("group by command_id")) return summaries;
    if (query.includes("from organelle.change_log"))
      return [
        {
          op: "rename_header",
          node_id: "team",
          before: { name: "Before" },
          after: { name: "After" },
        },
      ];
    if (query.includes("from organelle.trees"))
      return [
        {
          tree_id: "11111111-1111-4111-8111-111111111111",
          owner_auth_id: "owner",
          archived_at: null,
          access_level: "editor",
        },
      ];
    return [];
  });
  Object.assign(sql, { begin: async (run: (tx: typeof sql) => unknown) => run(sql) });
  return { requireActor, summaries, sql };
});
vi.mock("@/features/auth/session", () => ({ requireActor: harness.requireActor }));
vi.mock("@/lib/db", () => ({
  withDbRetry: (run: (sql: typeof harness.sql) => unknown) => run(harness.sql),
}));
vi.mock("./lock", async (load) => ({
  ...(await load<typeof import("./lock")>()),
  lockEditableSandbox: vi.fn(async () => null),
}));
vi.mock("./command-sql", () => ({ applyCommandSql: vi.fn(async () => []) }));
vi.mock("./change-log", () => ({ insertChangeLog: vi.fn() }));
import { getUndoState, undoLast, redoLast } from "./actions/undo";
import { undoChromeFor, loadCommandSummaries } from "./actions/shared";
import { applyCommandSql } from "./command-sql";
const treeId = "11111111-1111-4111-8111-111111111111";
describe("command ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.requireActor.mockResolvedValue({
      ok: true,
      actor: { authId: "actor-a", role: "editor" },
    });
    harness.summaries.splice(
      0,
      Infinity,
      { commandId: "a", kind: "user", undoesCommandId: null, actorAuthId: "actor-a" },
      { commandId: "b", kind: "user", undoesCommandId: null, actorAuthId: "actor-b" },
    );
  });
  it("does not expose or skip a foreign top command", async () => {
    expect(await getUndoState(treeId)).toMatchObject({ canUndo: false, undoLog: [] });
    expect(await undoLast(treeId)).toMatchObject({ ok: false });
    expect(applyCommandSql).not.toHaveBeenCalled();
  });
  it("does not redo another actor's command", async () => {
    harness.summaries.push({
      commandId: "undo-b",
      kind: "undo",
      undoesCommandId: "b",
      actorAuthId: "actor-b",
    });
    expect(await getUndoState(treeId)).toMatchObject({
      canUndo: true,
      canRedo: false,
      redoLog: [],
    });
    expect(await redoLast(treeId)).toMatchObject({ ok: false });
    expect(applyCommandSql).not.toHaveBeenCalled();
  });
  it("fails closed for legacy commands without an actor", async () => {
    harness.summaries[1]!.actorAuthId = null;
    expect(await undoLast(treeId)).toMatchObject({ ok: false });
    expect(applyCommandSql).not.toHaveBeenCalled();
  });
  it("offers the current actor their own top command", async () => {
    harness.summaries.pop();
    expect(await getUndoState(treeId)).toMatchObject({
      canUndo: true,
      undoCommandId: "a",
    });
  });
  it("scopes mutation acknowledgment controls to the actor", async () => {
    expect(
      await undoChromeFor(harness.sql as never, treeId, null, "actor-a"),
    ).toMatchObject({ canUndo: false, undoLog: [] });
  });
  it("loads the first user actor chronologically without skipping nulls", async () => {
    await loadCommandSummaries(harness.sql as never, treeId);
    const query = harness.sql.mock.calls[0]![0].join("?");
    expect(query).toContain("array_agg(actor_auth_id::text order by id)");
    expect(query).not.toContain("min(actor_auth_id");
  });
});
