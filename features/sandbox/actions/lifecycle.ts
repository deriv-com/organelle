"use server";

import { withDbRetry } from "@/lib/db";
import {
  logActionError,
  logActionRejected,
  logActionResult,
  logStart,
} from "@/lib/app-logging";
import {
  EDITOR_ROLES,
  getActor,
  hasAllowedRole,
  requireRole,
} from "@/features/auth/session";
import { UUID_RE } from "../lock";
import { listSandboxesForActor } from "../queries";
import type { SandboxSummary } from "../types";
import { pruneResignedEmptySeatsTx } from "@/features/employees/prune-resigned-seats.server";

export async function forkSandbox(
  name: string,
): Promise<{ ok: true; treeId: string; name: string } | { ok: false; reason: string }> {
  const startedAt = logStart();
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    logActionRejected({
      logger: "sandbox.lifecycle",
      operation: "fork_sandbox",
      eventName: "sandbox.fork.result",
      failureReason: "Name must be 1–80 characters",
      startedAt,
      fields: { name_length: trimmed.length },
    });
    return { ok: false, reason: "Name must be 1–80 characters" };
  }
  const access = await requireRole(EDITOR_ROLES);
  if (!access.ok) {
    logActionRejected({
      logger: "sandbox.lifecycle",
      operation: "fork_sandbox",
      eventName: "sandbox.fork.result",
      failureReason: access.reason,
      startedAt,
      fields: { auth_status: access.status },
    });
    return access;
  }
  const actor = access.actor.authId;
  try {
    const result = await withDbRetry(
      (sql) =>
        sql.begin(async (tx) => {
          const published = await tx<{ tree_id: string; version_seq: number }[]>`
        select tree_id, version_seq from organelle.trees where kind = 'published'
      `;
          if (published.length !== 1)
            throw new Error("expected exactly one published tree");
          const pub = published[0]!;

          const inserted = await tx<{ tree_id: string }[]>`
        insert into organelle.trees
          (kind, name, owner_auth_id, created_by_auth_id, forked_from_tree_id, forked_from_seq)
        values ('sandbox', ${trimmed}, ${actor}, ${actor}, ${pub.tree_id}, ${pub.version_seq})
        returning tree_id
      `;
          const treeId = inserted[0]!.tree_id;

          // Deep copy preserving node_id. Parents must insert before
          // children: the path trigger and the parent FK both require it.
          await tx`
        insert into organelle.nodes
          (tree_id, node_id, parent_node_id, node_type, sort_order, name, job_title, position_level, is_assistant, leaf_grid_columns)
        select ${treeId}, node_id, parent_node_id, node_type, sort_order, name, job_title, position_level, is_assistant, leaf_grid_columns
        from organelle.nodes
        where tree_id = ${pub.tree_id}
        order by nlevel(path)
      `;
          await tx`
        insert into organelle.seat_assignments
          (tree_id, node_id, employee_auth_id, is_host, is_primary, assigned_at)
        select ${treeId}, node_id, employee_auth_id, is_host, is_primary, assigned_at
        from organelle.seat_assignments
        where tree_id = ${pub.tree_id}
      `;

          await tx`
        insert into organelle.change_log (tree_id, actor_auth_id, op, before, after)
        values (
          ${treeId}, ${actor}, 'fork_sandbox',
          ${tx.json({ forked_from_seq: pub.version_seq })},
          ${tx.json({ tree_id: treeId })}
        )
      `;

          await pruneResignedEmptySeatsTx(tx, treeId, actor);
          await tx`select organelle.validate_tree(${treeId})`;
          return { ok: true as const, treeId, name: trimmed };
        }),
      {
        logger: "sandbox.lifecycle",
        operation: "fork_sandbox",
        fields: {
          actor_auth_id: actor,
          actor_role: access.actor.role,
        },
      },
    );
    logActionResult({
      logger: "sandbox.lifecycle",
      operation: "fork_sandbox",
      eventName: "sandbox.fork.result",
      result: "success",
      startedAt,
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        sandbox_tree_id: result.treeId,
      },
    });
    return result;
  } catch (error) {
    logActionError({
      logger: "sandbox.lifecycle",
      operation: "fork_sandbox",
      eventName: "sandbox.fork.error",
      error,
      startedAt,
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
      },
    });
    throw error;
  }
}

export type { SandboxSummary } from "../types";

export async function listSandboxes(): Promise<SandboxSummary[]> {
  const session = await getActor();
  if (!session.ok || !hasAllowedRole(session.actor.role, EDITOR_ROLES)) return [];
  return listSandboxesForActor(session.actor.authId);
}

/** Hard delete: the tree, nodes, and assignments are removed. Audit and merged
 * publication records remain with their sandbox references set to null. */
export async function deleteSandbox(treeId: string): Promise<boolean> {
  const startedAt = logStart();
  if (!UUID_RE.test(treeId)) {
    logActionRejected({
      logger: "sandbox.lifecycle",
      operation: "delete_sandbox",
      eventName: "sandbox.delete.result",
      failureReason: "Malformed id",
      startedAt,
      fields: { validation_target: "sandbox_tree_id" },
    });
    return false;
  }
  const access = await requireRole(EDITOR_ROLES);
  if (!access.ok) {
    logActionRejected({
      logger: "sandbox.lifecycle",
      operation: "delete_sandbox",
      eventName: "sandbox.delete.result",
      failureReason: access.reason,
      startedAt,
      fields: {
        auth_status: access.status,
        sandbox_tree_id: treeId,
      },
    });
    return false;
  }
  const actor = access.actor.authId;
  try {
    const deleted = await withDbRetry(
      async (sql) => {
        const rows = await sql<{ tree_id: string }[]>`
        delete from organelle.trees
        where tree_id = ${treeId} and kind = 'sandbox' and owner_auth_id = ${actor}
        returning tree_id
      `;
        return rows.length === 1;
      },
      {
        logger: "sandbox.lifecycle",
        operation: "delete_sandbox",
        fields: {
          actor_auth_id: actor,
          actor_role: access.actor.role,
          sandbox_tree_id: treeId,
        },
      },
    );
    logActionResult({
      logger: "sandbox.lifecycle",
      operation: "delete_sandbox",
      eventName: "sandbox.delete.result",
      result: deleted ? "success" : "rejected",
      failureReason: deleted ? undefined : "Sandbox not found or not owned by actor",
      startedAt,
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        sandbox_tree_id: treeId,
      },
    });
    return deleted;
  } catch (error) {
    logActionError({
      logger: "sandbox.lifecycle",
      operation: "delete_sandbox",
      eventName: "sandbox.delete.error",
      error,
      startedAt,
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        sandbox_tree_id: treeId,
      },
    });
    throw error;
  }
}

/** Soft archive via `archived_at`. */
export async function archiveSandbox(treeId: string): Promise<boolean> {
  const startedAt = logStart();
  if (!UUID_RE.test(treeId)) {
    logActionRejected({
      logger: "sandbox.lifecycle",
      operation: "archive_sandbox",
      eventName: "sandbox.archive.result",
      failureReason: "Malformed id",
      startedAt,
      fields: { validation_target: "sandbox_tree_id" },
    });
    return false;
  }
  const access = await requireRole(EDITOR_ROLES);
  if (!access.ok) {
    logActionRejected({
      logger: "sandbox.lifecycle",
      operation: "archive_sandbox",
      eventName: "sandbox.archive.result",
      failureReason: access.reason,
      startedAt,
      fields: {
        auth_status: access.status,
        sandbox_tree_id: treeId,
      },
    });
    return false;
  }
  const actor = access.actor.authId;
  try {
    const archived = await withDbRetry(
      async (sql) => {
        const rows = await sql<{ tree_id: string }[]>`
        update organelle.trees
        set archived_at = now()
        where tree_id = ${treeId}
          and kind = 'sandbox'
          and owner_auth_id = ${actor}
          and archived_at is null
        returning tree_id
      `;
        return rows.length === 1;
      },
      {
        logger: "sandbox.lifecycle",
        operation: "archive_sandbox",
        fields: {
          actor_auth_id: actor,
          actor_role: access.actor.role,
          sandbox_tree_id: treeId,
        },
      },
    );
    logActionResult({
      logger: "sandbox.lifecycle",
      operation: "archive_sandbox",
      eventName: "sandbox.archive.result",
      result: archived ? "success" : "rejected",
      failureReason: archived
        ? undefined
        : "Sandbox not found, not owned, or already archived",
      startedAt,
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        sandbox_tree_id: treeId,
      },
    });
    return archived;
  } catch (error) {
    logActionError({
      logger: "sandbox.lifecycle",
      operation: "archive_sandbox",
      eventName: "sandbox.archive.error",
      error,
      startedAt,
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        sandbox_tree_id: treeId,
      },
    });
    throw error;
  }
}

/** Restore an archived sandbox to active/editable. */
export async function restoreSandbox(treeId: string): Promise<boolean> {
  const startedAt = logStart();
  if (!UUID_RE.test(treeId)) {
    logActionRejected({
      logger: "sandbox.lifecycle",
      operation: "restore_sandbox",
      eventName: "sandbox.restore.result",
      failureReason: "Malformed id",
      startedAt,
      fields: { validation_target: "sandbox_tree_id" },
    });
    return false;
  }
  const access = await requireRole(EDITOR_ROLES);
  if (!access.ok) {
    logActionRejected({
      logger: "sandbox.lifecycle",
      operation: "restore_sandbox",
      eventName: "sandbox.restore.result",
      failureReason: access.reason,
      startedAt,
      fields: {
        auth_status: access.status,
        sandbox_tree_id: treeId,
      },
    });
    return false;
  }
  const actor = access.actor.authId;
  try {
    const restored = await withDbRetry(
      async (sql) => {
        const rows = await sql<{ tree_id: string }[]>`
        update organelle.trees
        set archived_at = null
        where tree_id = ${treeId}
          and kind = 'sandbox'
          and owner_auth_id = ${actor}
          and archived_at is not null
        returning tree_id
      `;
        return rows.length === 1;
      },
      {
        logger: "sandbox.lifecycle",
        operation: "restore_sandbox",
        fields: {
          actor_auth_id: actor,
          actor_role: access.actor.role,
          sandbox_tree_id: treeId,
        },
      },
    );
    logActionResult({
      logger: "sandbox.lifecycle",
      operation: "restore_sandbox",
      eventName: "sandbox.restore.result",
      result: restored ? "success" : "rejected",
      failureReason: restored
        ? undefined
        : "Sandbox not found, not owned, or already active",
      startedAt,
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        sandbox_tree_id: treeId,
      },
    });
    return restored;
  } catch (error) {
    logActionError({
      logger: "sandbox.lifecycle",
      operation: "restore_sandbox",
      eventName: "sandbox.restore.error",
      error,
      startedAt,
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        sandbox_tree_id: treeId,
      },
    });
    throw error;
  }
}
