"use server";

/**
 * Merge server actions. Preview + commit both run the same
 * TypeScript engine; apply_merge is the atomic writer.
 */

import { applyStagedEmployeeEdits } from "@/features/sandbox/staged-employees";
import { withDbRetry } from "@/lib/db";
import {
  logActionError,
  logActionRejected,
  logActionResult,
  logStart,
} from "@/lib/app-logging";
import { fetchPublishedTree, fetchTree } from "@/features/chart/tree-query";
import { EDITOR_ROLES, requireActor, requireRole } from "@/features/auth/session";
import type { Actor } from "@/features/auth/policy";
import {
  canOverrideChangeReason,
  parseManualChangeReason,
  type ManualChangeReason,
} from "@/features/reports/changes/labels";
import { buildProspectiveChangeReasons } from "@/features/reports/changes/prospective";
import { getSandboxAccess, sandboxAccessWithSql } from "@/features/sandbox/access";
import { runMerge } from "./engine";
import { fetchPublishedEmployeeDetails } from "./published-employee-details";
import {
  employeeDetailsFromRows,
  indexRows,
  nodeLabel,
  overridesFromRows,
  toQueryRows,
} from "./tree";
import type { MergeResult, MergeTarget, OverrideMap, Resolution } from "./types";

import { UUID_RE } from "@/lib/uuid";

export type PreviewPayload = {
  sandboxTreeId: string;
  sandboxName: string;
  stagedEmployeeCount?: number;
  liveSeq: number;
  forkedFromSeq: number;
  zeroDrift: boolean;
  drift: boolean;
  valid: boolean;
  changes: MergeResult["changes"];
  conflicts: MergeResult["conflicts"];
  unresolved: MergeResult["unresolved"];
  graphConflicts: MergeResult["graphConflicts"];
  counts: MergeResult["counts"];
  tints: MergeResult["tints"];
  previewRows: ReturnType<typeof toQueryRows>;
  liveRows: ReturnType<typeof toQueryRows>;
  baseRows: ReturnType<typeof toQueryRows>;
  sandboxRows: ReturnType<typeof toQueryRows>;
  liveEmployeeDetails: OverrideMap;
  destinations: { id: string; label: string }[];
};

type MergeActor = { authId: string; role: string };

async function requirePublishAccess(
  sandboxTreeId: string,
): Promise<
  { ok: true; actor: Actor } | { ok: false; reason: string; status?: number }
> {
  const session = await requireActor();
  if (!session.ok) return { ok: false, reason: "Not allowed", status: session.status };
  const access = await getSandboxAccess(sandboxTreeId, session.actor);
  if (!access?.canPublish) return { ok: false, reason: "Not allowed", status: 403 };
  return { ok: true, actor: session.actor };
}

function logMergeRejection(args: {
  operation: string;
  eventName: string;
  failureReason: string;
  startedAt: number;
  actor?: MergeActor;
  fields?: Record<string, unknown>;
}): void {
  logActionRejected({
    logger: "merge.workflow",
    operation: args.operation,
    eventName: args.eventName,
    failureReason: args.failureReason,
    startedAt: args.startedAt,
    fields: {
      actor_auth_id: args.actor?.authId,
      actor_role: args.actor?.role,
      ...(args.fields ?? {}),
    },
  });
}

async function loadAndMerge(
  sandboxTreeId: string,
  options?: {
    target?: MergeTarget;
    resolutions?: Record<string, Resolution>;
    includedKeys?: string[] | null;
  },
): Promise<
  { preview: PreviewPayload; liveSeq: number; result: MergeResult } | { error: string }
> {
  const target = options?.target ?? "published";
  if (!UUID_RE.test(sandboxTreeId)) return { error: "Malformed id" };
  const sandbox = await fetchTree(sandboxTreeId);
  if (!sandbox || !sandbox.forkedFromTreeId) return { error: "Sandbox not found" };
  if (sandbox.archived) {
    return { error: "Sandbox is archived — restore it first" };
  }
  const live = await fetchPublishedTree();
  const baseTree = await fetchTree(sandbox.forkedFromTreeId);
  if (!baseTree) return { error: "Fork point tree is gone" };

  const baseOverrides = overridesFromRows(baseTree.rows);
  const liveOverrides = overridesFromRows(live.rows);
  const sandboxOverrides = overridesFromRows(sandbox.rows);
  const overrideAuthIds = [
    ...new Set([
      ...Object.keys(baseOverrides),
      ...Object.keys(liveOverrides),
      ...Object.keys(sandboxOverrides),
    ]),
  ];
  const liveEmployeeDetails = {
    ...employeeDetailsFromRows(live.rows),
    ...(await fetchPublishedEmployeeDetails(overrideAuthIds)),
  };

  const result = runMerge({
    base: indexRows(baseTree.rows),
    live: indexRows(live.rows),
    sandbox: indexRows(sandbox.rows),
    liveSeq: live.versionSeq,
    forkedFromSeq: sandbox.forkedFromSeq,
    target,
    resolutions: options?.resolutions,
    includedKeys: target === "sandbox" ? null : options?.includedKeys,
    baseOverrides,
    liveOverrides,
    sandboxOverrides,
    liveEmployeeDetails,
  });

  const stagedEmployeeCount = await withDbRetry(async (sql) => {
    const rows = await sql<
      { count: number }[]
    >`select count(*)::int as count from organelle.sandbox_employee_edits where tree_id = ${sandboxTreeId}`;
    return rows[0]?.count ?? 0;
  });
  const preview: PreviewPayload = {
    stagedEmployeeCount,
    sandboxTreeId,
    sandboxName: sandbox.name,
    liveSeq: live.versionSeq,
    forkedFromSeq: sandbox.forkedFromSeq,
    zeroDrift: result.zeroDrift,
    drift: result.drift,
    valid: result.valid,
    changes: result.changes,
    conflicts: result.conflicts,
    unresolved: result.unresolved,
    graphConflicts: result.graphConflicts,
    counts: result.counts,
    tints: result.tints,
    previewRows: toQueryRows(result.merged),
    liveRows: live.rows,
    baseRows: baseTree.rows,
    sandboxRows: sandbox.rows,
    liveEmployeeDetails,
    destinations: result.merged.map((node) => ({
      id: node.id,
      label: nodeLabel(node),
    })),
  };
  return { preview, liveSeq: live.versionSeq, result };
}

export async function previewMerge(
  sandboxTreeId: string,
): Promise<PreviewPayload | { error: string }> {
  const startedAt = logStart();
  const access = await requirePublishAccess(sandboxTreeId);
  if (!access.ok) {
    logMergeRejection({
      operation: "preview_merge",
      eventName: "merge.preview.result",
      failureReason: access.reason,
      startedAt,
      fields: {
        auth_status: access.status,
        sandbox_tree_id: sandboxTreeId,
      },
    });
    return { error: access.reason };
  }
  const loaded = await loadAndMerge(sandboxTreeId);
  if ("error" in loaded) {
    logActionResult({
      logger: "merge.workflow",
      operation: "preview_merge",
      eventName: "merge.preview.result",
      result: "rejected",
      failureReason: loaded.error,
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
        sandbox_tree_id: sandboxTreeId,
      },
    });
    return loaded;
  }
  logActionResult({
    logger: "merge.workflow",
    operation: "preview_merge",
    eventName: "merge.preview.result",
    result: "success",
    startedAt,
    fields: {
      actor_auth_id: access.actor.authId,
      actor_role: access.actor.role,
      sandbox_tree_id: sandboxTreeId,
      live_seq: loaded.preview.liveSeq,
      forked_from_seq: loaded.preview.forkedFromSeq,
      change_count: loaded.preview.changes.length,
      conflict_count: loaded.preview.conflicts.length,
      unresolved_count: loaded.preview.unresolved.length,
      graph_conflict_count: loaded.preview.graphConflicts.length,
    },
  });
  return loaded.preview;
}

async function requireOwnedSandbox(
  sandboxTreeId: string,
): Promise<{ ok: true; actor: MergeActor } | { ok: false; reason: string }> {
  const access = await requireRole(EDITOR_ROLES);
  if (!access.ok) return access;
  const sandbox = await fetchTree(sandboxTreeId);
  if (!sandbox || sandbox.kind !== "sandbox") {
    return { ok: false, reason: "Sandbox not found" };
  }
  if (sandbox.ownerAuthId !== access.actor.authId) {
    return { ok: false, reason: "Only the sandbox owner can do this" };
  }
  return { ok: true, actor: access.actor };
}

export async function previewSync(
  sandboxTreeId: string,
): Promise<PreviewPayload | { error: string }> {
  const startedAt = logStart();
  const access = await requireOwnedSandbox(sandboxTreeId);
  if (!access.ok) {
    logMergeRejection({
      operation: "preview_sync",
      eventName: "sync.preview.result",
      failureReason: access.reason,
      startedAt,
      fields: {
        sandbox_tree_id: sandboxTreeId,
      },
    });
    return { error: access.reason };
  }
  const loaded = await loadAndMerge(sandboxTreeId, { target: "sandbox" });
  if ("error" in loaded) {
    logActionResult({
      logger: "merge.workflow",
      operation: "preview_sync",
      eventName: "sync.preview.result",
      result: "rejected",
      failureReason: loaded.error,
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
        sandbox_tree_id: sandboxTreeId,
      },
    });
    return loaded;
  }
  if (loaded.preview.zeroDrift) {
    logActionResult({
      logger: "merge.workflow",
      operation: "preview_sync",
      eventName: "sync.preview.result",
      result: "rejected",
      failureReason: "Sandbox is already up to date with live",
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
        sandbox_tree_id: sandboxTreeId,
        live_seq: loaded.preview.liveSeq,
        forked_from_seq: loaded.preview.forkedFromSeq,
      },
    });
    return { error: "Sandbox is already up to date with live" };
  }
  logActionResult({
    logger: "merge.workflow",
    operation: "preview_sync",
    eventName: "sync.preview.result",
    result: "success",
    startedAt,
    fields: {
      actor_auth_id: access.actor.authId,
      actor_role: access.actor.role,
      sandbox_tree_id: sandboxTreeId,
      live_seq: loaded.preview.liveSeq,
      forked_from_seq: loaded.preview.forkedFromSeq,
      change_count: loaded.preview.changes.length,
      conflict_count: loaded.preview.conflicts.length,
      unresolved_count: loaded.preview.unresolved.length,
      graph_conflict_count: loaded.preview.graphConflicts.length,
    },
  });
  return loaded.preview;
}

export async function commitSync(args: {
  sandboxTreeId: string;
  resolutions: Record<string, Resolution>;
  cachedAtSeq: number;
}): Promise<
  | { ok: true; sandboxTreeId: string }
  | {
      ok: false;
      code: "live_moved" | "conflicts";
      preview: PreviewPayload;
      message: string;
    }
  | { ok: false; code: "error"; reason: string }
> {
  const startedAt = logStart();
  const access = await requireOwnedSandbox(args.sandboxTreeId);
  if (!access.ok) {
    logMergeRejection({
      operation: "commit_sync",
      eventName: "sync.commit.result",
      failureReason: access.reason,
      startedAt,
      fields: {
        sandbox_tree_id: args.sandboxTreeId,
        cached_at_seq: args.cachedAtSeq,
      },
    });
    return { ok: false, code: "error", reason: access.reason };
  }
  const loaded = await loadAndMerge(args.sandboxTreeId, {
    target: "sandbox",
    resolutions: args.resolutions,
  });
  if ("error" in loaded) {
    logActionResult({
      logger: "merge.workflow",
      operation: "commit_sync",
      eventName: "sync.commit.result",
      result: "rejected",
      failureReason: loaded.error,
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
        sandbox_tree_id: args.sandboxTreeId,
        cached_at_seq: args.cachedAtSeq,
      },
    });
    return { ok: false, code: "error", reason: loaded.error };
  }
  if (loaded.preview.zeroDrift) {
    logActionResult({
      logger: "merge.workflow",
      operation: "commit_sync",
      eventName: "sync.commit.result",
      result: "rejected",
      failureReason: "Sandbox is already up to date with live",
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
        sandbox_tree_id: args.sandboxTreeId,
        live_seq: loaded.liveSeq,
        cached_at_seq: args.cachedAtSeq,
      },
    });
    return {
      ok: false,
      code: "error",
      reason: "Sandbox is already up to date with live",
    };
  }

  if (loaded.liveSeq !== args.cachedAtSeq) {
    logActionResult({
      logger: "merge.workflow",
      operation: "commit_sync",
      eventName: "sync.commit.result",
      result: "live_moved",
      failureReason: "Live moved on while resolving",
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
        sandbox_tree_id: args.sandboxTreeId,
        live_seq: loaded.liveSeq,
        cached_at_seq: args.cachedAtSeq,
      },
    });
    return {
      ok: false,
      code: "live_moved",
      preview: loaded.preview,
      message: "Live moved on while you were resolving — restarting",
    };
  }

  const blocking = [...loaded.result.unresolved, ...loaded.result.graphConflicts];
  if (blocking.length > 0 || !loaded.result.valid) {
    logActionResult({
      logger: "merge.workflow",
      operation: "commit_sync",
      eventName: "sync.commit.result",
      result: "conflicts",
      failureReason: "Unresolved conflicts remain",
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
        sandbox_tree_id: args.sandboxTreeId,
        live_seq: loaded.liveSeq,
        cached_at_seq: args.cachedAtSeq,
        conflict_count: loaded.result.conflicts.length,
        unresolved_count: loaded.result.unresolved.length,
        graph_conflict_count: loaded.result.graphConflicts.length,
      },
    });
    return {
      ok: false,
      code: "conflicts",
      preview: loaded.preview,
      message: "Unresolved conflicts remain",
    };
  }

  const actor = access.actor.authId;
  try {
    const sandboxTreeId = await withDbRetry(
      async (sql) =>
        sql.begin(async (tx) => {
          const sandbox = await tx<
            { forked_from_seq: number; archived_at: string | null }[]
          >`
          select forked_from_seq, archived_at::text
          from organelle.trees
          where tree_id = ${args.sandboxTreeId}
            and kind = 'sandbox'
            and owner_auth_id = ${actor}
          for update
        `;
          if (sandbox.length !== 1) throw new Error("Sandbox not found");
          if (sandbox[0]!.archived_at !== null) {
            throw new Error("Sandbox is archived — restore it first");
          }

          const inserted = await tx<{ sync_id: string }[]>`
          insert into organelle.sandbox_syncs (
            sandbox_tree_id, forked_from_seq, target_seq, actor_auth_id,
            resolutions, counts, snapshot
          ) values (
            ${args.sandboxTreeId},
            ${sandbox[0]!.forked_from_seq},
            ${loaded.liveSeq},
            ${actor},
            ${tx.json(args.resolutions)},
            ${tx.json(loaded.result.counts)},
            ${tx.json(JSON.parse(JSON.stringify(loaded.result.snapshot)))}
          )
          returning sync_id
        `;
          const rows = await tx<{ apply_sync_to_sandbox: string }[]>`
          select organelle.apply_sync_to_sandbox(${inserted[0]!.sync_id}::uuid, ${actor}::uuid)
        `;
          return rows[0]!.apply_sync_to_sandbox;
        }),
      {
        logger: "merge.workflow",
        operation: "commit_sync",
        fields: {
          actor_auth_id: actor,
          actor_role: access.actor.role,
          sandbox_tree_id: args.sandboxTreeId,
          live_seq: loaded.liveSeq,
        },
      },
    );
    logActionResult({
      logger: "merge.workflow",
      operation: "commit_sync",
      eventName: "sync.commit.result",
      result: "success",
      startedAt,
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        sandbox_tree_id: args.sandboxTreeId,
        tree_id: sandboxTreeId,
        live_seq: loaded.liveSeq,
        forked_from_seq: loaded.preview.forkedFromSeq,
        cached_at_seq: args.cachedAtSeq,
        change_count: loaded.preview.changes.length,
        conflict_count: loaded.preview.conflicts.length,
        unresolved_count: loaded.preview.unresolved.length,
        graph_conflict_count: loaded.preview.graphConflicts.length,
      },
    });
    return { ok: true, sandboxTreeId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/race_conflict/.test(message)) {
      const again = await loadAndMerge(args.sandboxTreeId, {
        target: "sandbox",
        resolutions: args.resolutions,
      });
      if ("error" in again) {
        logMergeRejection({
          operation: "commit_sync",
          eventName: "sync.commit.result",
          failureReason: again.error,
          startedAt,
          actor: access.actor,
          fields: {
            sandbox_tree_id: args.sandboxTreeId,
            cached_at_seq: args.cachedAtSeq,
          },
        });
        return { ok: false, code: "error", reason: again.error };
      }
      logActionResult({
        logger: "merge.workflow",
        operation: "commit_sync",
        eventName: "sync.commit.result",
        result: "live_moved",
        failureReason: "Race conflict while applying sync",
        startedAt,
        fields: {
          actor_auth_id: actor,
          actor_role: access.actor.role,
          sandbox_tree_id: args.sandboxTreeId,
          live_seq: loaded.liveSeq,
          cached_at_seq: args.cachedAtSeq,
        },
      });
      return {
        ok: false,
        code: "live_moved",
        preview: again.preview,
        message: "Live moved on while you were resolving — restarting",
      };
    }
    if (/archived/.test(message)) {
      logActionResult({
        logger: "merge.workflow",
        operation: "commit_sync",
        eventName: "sync.commit.result",
        result: "rejected",
        failureReason: "Sandbox is archived — restore it first",
        startedAt,
        fields: {
          actor_auth_id: actor,
          actor_role: access.actor.role,
          sandbox_tree_id: args.sandboxTreeId,
        },
      });
      return {
        ok: false,
        code: "error",
        reason: "Sandbox is archived — restore it first",
      };
    }
    logActionError({
      logger: "merge.workflow",
      operation: "commit_sync",
      eventName: "sync.commit.error",
      error,
      failureReason: "Sync failed — no changes were applied",
      startedAt,
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        sandbox_tree_id: args.sandboxTreeId,
        live_seq: loaded.liveSeq,
        cached_at_seq: args.cachedAtSeq,
      },
    });
    return {
      ok: false,
      code: "error",
      reason: "Sync failed — no changes were applied",
    };
  }
}

export async function commitMerge(args: {
  sandboxTreeId: string;
  title: string;
  resolutions: Record<string, Resolution>;
  includedKeys: string[] | null;
  changeReasonOverrides: Record<string, ManualChangeReason>;
  cachedAtSeq: number;
}): Promise<
  | { ok: true; resultingTreeId: string }
  | {
      ok: false;
      code: "live_moved" | "conflicts" | "invalid";
      preview: PreviewPayload;
      message: string;
    }
  | { ok: false; code: "error"; reason: string }
> {
  const startedAt = logStart();
  const title = args.title.trim();
  if (title.length < 1 || title.length > 200) {
    logMergeRejection({
      operation: "commit_merge",
      eventName: "merge.commit.result",
      failureReason: "Title must be 1–200 characters",
      startedAt,
      fields: {
        sandbox_tree_id: UUID_RE.test(args.sandboxTreeId)
          ? args.sandboxTreeId
          : undefined,
        title_length: title.length,
        cached_at_seq: args.cachedAtSeq,
        included_count: args.includedKeys?.length ?? null,
      },
    });
    return { ok: false, code: "error", reason: "Title must be 1–200 characters" };
  }
  const access = await requirePublishAccess(args.sandboxTreeId);
  if (!access.ok) {
    logMergeRejection({
      operation: "commit_merge",
      eventName: "merge.commit.result",
      failureReason: access.reason,
      startedAt,
      fields: {
        auth_status: access.status,
        sandbox_tree_id: UUID_RE.test(args.sandboxTreeId)
          ? args.sandboxTreeId
          : undefined,
        cached_at_seq: args.cachedAtSeq,
        included_count: args.includedKeys?.length ?? null,
      },
    });
    return { ok: false, code: "error", reason: access.reason };
  }
  const loaded = await loadAndMerge(args.sandboxTreeId, {
    resolutions: args.resolutions,
    includedKeys: args.includedKeys,
  });
  if ("error" in loaded) {
    logActionResult({
      logger: "merge.workflow",
      operation: "commit_merge",
      eventName: "merge.commit.result",
      result: "rejected",
      failureReason: loaded.error,
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
        sandbox_tree_id: args.sandboxTreeId,
        cached_at_seq: args.cachedAtSeq,
        included_count: args.includedKeys?.length ?? null,
      },
    });
    return { ok: false, code: "error", reason: loaded.error };
  }

  if (loaded.liveSeq !== args.cachedAtSeq) {
    logActionResult({
      logger: "merge.workflow",
      operation: "commit_merge",
      eventName: "merge.commit.result",
      result: "live_moved",
      failureReason: "Live moved on while resolving",
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
        sandbox_tree_id: args.sandboxTreeId,
        live_seq: loaded.liveSeq,
        cached_at_seq: args.cachedAtSeq,
        included_count: args.includedKeys?.length ?? null,
      },
    });
    return {
      ok: false,
      code: "live_moved",
      preview: loaded.preview,
      message: "Live moved on while you were resolving — restarting",
    };
  }

  const blocking = [...loaded.result.unresolved, ...loaded.result.graphConflicts];
  if (blocking.length > 0 || !loaded.result.valid) {
    logActionResult({
      logger: "merge.workflow",
      operation: "commit_merge",
      eventName: "merge.commit.result",
      result: "conflicts",
      failureReason: "Unresolved conflicts remain",
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
        sandbox_tree_id: args.sandboxTreeId,
        live_seq: loaded.liveSeq,
        cached_at_seq: args.cachedAtSeq,
        included_count: args.includedKeys?.length ?? null,
        conflict_count: loaded.result.conflicts.length,
        unresolved_count: loaded.result.unresolved.length,
        graph_conflict_count: loaded.result.graphConflicts.length,
      },
    });
    return {
      ok: false,
      code: "conflicts",
      preview: loaded.preview,
      message: "Unresolved conflicts remain",
    };
  }

  const prospectiveReasons = buildProspectiveChangeReasons(
    loaded.preview.liveRows,
    toQueryRows(loaded.result.merged),
  );
  const prospectiveByNode = new Map(
    prospectiveReasons.map((reason) => [reason.nodeId, reason]),
  );
  const validatedOverrides: Record<string, ManualChangeReason> = {};
  for (const [nodeId, value] of Object.entries(args.changeReasonOverrides ?? {})) {
    const reason = parseManualChangeReason(value);
    const prospective = prospectiveByNode.get(nodeId);
    if (
      !UUID_RE.test(nodeId) ||
      !reason ||
      !prospective ||
      !canOverrideChangeReason(prospective.automaticType)
    ) {
      return {
        ok: false,
        code: "error",
        reason: "One or more change reason selections are no longer valid",
      };
    }
    validatedOverrides[nodeId] = reason;
  }
  const storedReasons =
    prospectiveReasons.length === 0
      ? null
      : Object.fromEntries(
          prospectiveReasons.map((reason) => [
            reason.nodeId,
            validatedOverrides[reason.nodeId] ?? null,
          ]),
        );

  const actor = access.actor.authId;
  try {
    const resultingTreeId = await withDbRetry(
      async (sql) =>
        sql.begin(async (tx) => {
          const sandbox = await tx<
            { forked_from_seq: number; archived_at: string | null }[]
          >`
          select forked_from_seq, archived_at::text
          from organelle.trees
          where tree_id = ${args.sandboxTreeId} and kind = 'sandbox'
          for update
        `;
          if (sandbox.length !== 1) throw new Error("Sandbox not found");
          if (sandbox[0]!.archived_at !== null) {
            throw new Error("Sandbox is archived — restore it first");
          }
          const lockedAccess = await sandboxAccessWithSql(
            tx,
            args.sandboxTreeId,
            access.actor,
          );
          if (!lockedAccess?.canPublish) {
            throw new Error("Publish access was removed");
          }

          await applyStagedEmployeeEdits(tx, args.sandboxTreeId);
          const inserted = await tx<{ merge_id: string }[]>`
          insert into organelle.sandbox_merges (
            sandbox_tree_id, forked_from_seq, target_seq, merger_auth_id,
            title, resolutions, included_keys, counts, snapshot, change_reason_overrides
          ) values (
            ${args.sandboxTreeId},
            ${sandbox[0]!.forked_from_seq},
            ${loaded.liveSeq},
            ${actor},
            ${title},
            ${tx.json(args.resolutions)},
            ${args.includedKeys === null ? null : tx.json(args.includedKeys)},
            ${tx.json(loaded.result.counts)},
            ${tx.json(JSON.parse(JSON.stringify(loaded.result.snapshot)))},
            ${storedReasons === null ? null : tx.json(storedReasons)}
          )
          returning merge_id
        `;
          const rows = await tx<{ apply_merge: string }[]>`
          select organelle.apply_merge(${inserted[0]!.merge_id}::uuid, ${actor}::uuid)
        `;
          await tx`
          update organelle.trees
          set archived_at = coalesce(archived_at, now())
          where tree_id = ${args.sandboxTreeId} and kind = 'sandbox'
        `;
          await tx`
          insert into organelle.change_log
            (tree_id, actor_auth_id, op, employee_auth_id, before, after)
          select
            s.sandbox_tree_id,
            ${actor},
            'expire_sandbox_access',
            s.recipient_auth_id,
            jsonb_build_object('access_level', s.access_level::text),
            jsonb_build_object('reason', 'published')
          from organelle.sandbox_shares s
          where s.sandbox_tree_id = ${args.sandboxTreeId}
            and s.revoked_at is null and s.expired_at is null
        `;
          await tx`
          update organelle.sandbox_shares
          set expired_at = now(), expiry_reason = 'published'
          where sandbox_tree_id = ${args.sandboxTreeId}
            and revoked_at is null and expired_at is null
        `;
          return rows[0]!.apply_merge;
        }),
      {
        logger: "merge.workflow",
        operation: "commit_merge",
        fields: {
          actor_auth_id: actor,
          actor_role: access.actor.role,
          sandbox_tree_id: args.sandboxTreeId,
          live_seq: loaded.liveSeq,
        },
      },
    );
    logActionResult({
      logger: "merge.workflow",
      operation: "commit_merge",
      eventName: "merge.commit.result",
      result: "success",
      startedAt,
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        sandbox_tree_id: args.sandboxTreeId,
        tree_id: resultingTreeId,
        live_seq: loaded.liveSeq,
        forked_from_seq: loaded.preview.forkedFromSeq,
        cached_at_seq: args.cachedAtSeq,
        included_count: args.includedKeys?.length ?? null,
        change_count: loaded.preview.changes.length,
        conflict_count: loaded.preview.conflicts.length,
        unresolved_count: loaded.preview.unresolved.length,
        graph_conflict_count: loaded.preview.graphConflicts.length,
      },
    });
    return { ok: true, resultingTreeId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/race_conflict/.test(message)) {
      const again = await loadAndMerge(args.sandboxTreeId, {
        resolutions: args.resolutions,
        includedKeys: args.includedKeys,
      });
      if ("error" in again) {
        logMergeRejection({
          operation: "commit_merge",
          eventName: "merge.commit.result",
          failureReason: again.error,
          startedAt,
          actor: access.actor,
          fields: {
            sandbox_tree_id: args.sandboxTreeId,
            cached_at_seq: args.cachedAtSeq,
            included_count: args.includedKeys?.length ?? null,
          },
        });
        return { ok: false, code: "error", reason: again.error };
      }
      logActionResult({
        logger: "merge.workflow",
        operation: "commit_merge",
        eventName: "merge.commit.result",
        result: "live_moved",
        failureReason: "Race conflict while applying merge",
        startedAt,
        fields: {
          actor_auth_id: actor,
          actor_role: access.actor.role,
          sandbox_tree_id: args.sandboxTreeId,
          live_seq: loaded.liveSeq,
          cached_at_seq: args.cachedAtSeq,
          included_count: args.includedKeys?.length ?? null,
        },
      });
      return {
        ok: false,
        code: "live_moved",
        preview: again.preview,
        message: "Live moved on while you were resolving — restarting",
      };
    }
    if (/archived/.test(message)) {
      logActionResult({
        logger: "merge.workflow",
        operation: "commit_merge",
        eventName: "merge.commit.result",
        result: "rejected",
        failureReason: "Sandbox is archived — restore it first",
        startedAt,
        fields: {
          actor_auth_id: actor,
          actor_role: access.actor.role,
          sandbox_tree_id: args.sandboxTreeId,
        },
      });
      return {
        ok: false,
        code: "error",
        reason: "Sandbox is archived — restore it first",
      };
    }
    if (/Publish access was removed/.test(message)) {
      logMergeRejection({
        operation: "commit_merge",
        eventName: "merge.commit.result",
        failureReason: "Not allowed",
        startedAt,
        actor: access.actor,
        fields: {
          sandbox_tree_id: args.sandboxTreeId,
          cached_at_seq: args.cachedAtSeq,
          included_count: args.includedKeys?.length ?? null,
        },
      });
      return { ok: false, code: "error", reason: "Not allowed" };
    }
    logActionError({
      logger: "merge.workflow",
      operation: "commit_merge",
      eventName: "merge.commit.error",
      error,
      failureReason: "Merge failed — no changes were published",
      startedAt,
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        sandbox_tree_id: args.sandboxTreeId,
        live_seq: loaded.liveSeq,
        cached_at_seq: args.cachedAtSeq,
        included_count: args.includedKeys?.length ?? null,
      },
    });
    return {
      ok: false,
      code: "error",
      reason: "Merge failed — no changes were published",
    };
  }
}

export async function reForkSandbox(
  treeId: string,
): Promise<{ ok: true; treeId: string; name: string } | { ok: false; reason: string }> {
  const startedAt = logStart();
  if (!UUID_RE.test(treeId)) {
    logMergeRejection({
      operation: "refork_sandbox",
      eventName: "sandbox.refork.result",
      failureReason: "Malformed id",
      startedAt,
      fields: { validation_target: "sandbox_tree_id" },
    });
    return { ok: false, reason: "Malformed id" };
  }
  const access = await requireRole(EDITOR_ROLES);
  if (!access.ok) {
    logMergeRejection({
      operation: "refork_sandbox",
      eventName: "sandbox.refork.result",
      failureReason: access.reason,
      startedAt,
      fields: {
        auth_status: access.status,
        sandbox_tree_id: treeId,
      },
    });
    return access;
  }
  const actor = access.actor.authId;
  try {
    const result = await withDbRetry(
      (sql) =>
        sql.begin(async (tx) => {
          const existing = await tx<{ name: string; archived_at: string | null }[]>`
            select name, archived_at::text from organelle.trees
            where tree_id = ${treeId} and kind = 'sandbox' and owner_auth_id = ${actor}
            for update
          `;
          if (existing.length !== 1) throw new Error("Sandbox not found");
          if (existing[0]!.archived_at !== null) {
            throw new Error("Sandbox is archived — restore it first");
          }
          const name = existing[0]!.name;

          await tx`delete from organelle.sandbox_syncs where sandbox_tree_id = ${treeId}`;
          await tx`
            delete from organelle.trees
            where tree_id = ${treeId} and kind = 'sandbox' and owner_auth_id = ${actor}
          `;

          const published = await tx<{ tree_id: string; version_seq: number }[]>`
            select tree_id, version_seq from organelle.trees where kind = 'published'
          `;
          if (published.length !== 1)
            throw new Error("expected exactly one published tree");
          const pub = published[0]!;

          const inserted = await tx<{ tree_id: string }[]>`
            insert into organelle.trees
              (kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
            values ('sandbox', ${name}, ${actor}, ${actor}, ${pub.tree_id}, ${pub.version_seq})
            returning tree_id
          `;
          const newId = inserted[0]!.tree_id;
          await tx`
            insert into organelle.nodes
              (tree_id, node_id, parent_node_id, node_type, sort_order, name, job_title, position_level, is_assistant, leaf_grid_columns)
            select ${newId}, node_id, parent_node_id, node_type, sort_order, name, job_title, position_level, is_assistant, leaf_grid_columns
            from organelle.nodes
            where tree_id = ${pub.tree_id}
            order by nlevel(path)
          `;
          await tx`
            insert into organelle.seat_assignments
              (tree_id, node_id, employee_auth_id, is_host, is_primary, assigned_at)
            select ${newId}, node_id, employee_auth_id, is_host, is_primary, assigned_at
            from organelle.seat_assignments
            where tree_id = ${pub.tree_id}
          `;
          await tx`
            insert into organelle.change_log (tree_id, actor_auth_id, op, before, after)
            values (
              ${newId}, ${actor}, 'fork_sandbox',
              ${tx.json({ forked_from_seq: pub.version_seq, refork_of: treeId })},
              ${tx.json({ tree_id: newId })}
            )
          `;
          await tx`select organelle.validate_tree(${newId})`;
          return { ok: true as const, treeId: newId, name };
        }),
      {
        logger: "merge.workflow",
        operation: "refork_sandbox",
        fields: {
          actor_auth_id: actor,
          actor_role: access.actor.role,
          sandbox_tree_id: treeId,
        },
      },
    );
    logActionResult({
      logger: "merge.workflow",
      operation: "refork_sandbox",
      eventName: "sandbox.refork.result",
      result: "success",
      startedAt,
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        sandbox_tree_id: treeId,
        tree_id: result.treeId,
      },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("archived")) {
      logActionResult({
        logger: "merge.workflow",
        operation: "refork_sandbox",
        eventName: "sandbox.refork.result",
        result: "rejected",
        failureReason: "Sandbox is archived — restore it first",
        startedAt,
        fields: {
          actor_auth_id: actor,
          actor_role: access.actor.role,
          sandbox_tree_id: treeId,
        },
      });
      return { ok: false, reason: "Sandbox is archived — restore it first" };
    }
    logActionError({
      logger: "merge.workflow",
      operation: "refork_sandbox",
      eventName: "sandbox.refork.error",
      error,
      failureReason: "Could not re-fork this sandbox",
      startedAt,
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        sandbox_tree_id: treeId,
      },
    });
    return { ok: false, reason: "Could not re-fork this sandbox" };
  }
}
