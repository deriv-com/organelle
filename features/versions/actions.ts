"use server";

/**
 * Published version list + restore. Restore copies a historical
 * tree forward as a new published seq — it never rewinds.
 */

import { withDbRetry } from "@/lib/db";
import {
  logActionError,
  logActionRejected,
  logActionResult,
  logStart,
} from "@/lib/app-logging";
import { RESTORE_ROLES, requireRole } from "@/features/auth/session";
import { restoreSourceAllowed } from "./policy";
import { listVersionsForAdminPage } from "./queries";
import type { VersionSummary } from "./types";

import { UUID_RE } from "@/lib/uuid";

export type { VersionSummary } from "./types";

export async function listVersions(): Promise<VersionSummary[]> {
  const access = await requireRole(RESTORE_ROLES);
  if (!access.ok) return [];
  return listVersionsForAdminPage();
}

export async function restoreVersion(
  treeId: string,
): Promise<{ ok: true; treeId: string } | { ok: false; reason: string }> {
  const startedAt = logStart();
  if (!UUID_RE.test(treeId)) {
    logActionRejected({
      logger: "versions.actions",
      operation: "restore_version",
      eventName: "versions.restore.result",
      failureReason: "Malformed id",
      startedAt,
      fields: { validation_target: "tree_id" },
    });
    return { ok: false, reason: "Malformed id" };
  }
  const access = await requireRole(RESTORE_ROLES);
  if (!access.ok) {
    logActionRejected({
      logger: "versions.actions",
      operation: "restore_version",
      eventName: "versions.restore.result",
      failureReason: access.reason,
      startedAt,
      fields: {
        auth_status: access.status,
        tree_id: treeId,
      },
    });
    return access;
  }
  const actor = access.actor.authId;

  try {
    const result = await withDbRetry(
      (sql) =>
        sql.begin(async (tx) => {
          const live = await tx<{ tree_id: string; version_seq: number }[]>`
        select tree_id, version_seq from organelle.trees
        where kind = 'published'
        for update
      `;
          if (live.length !== 1)
            return { ok: false as const, reason: "No published tree" };
          const pub = live[0]!;

          const source = await tx<
            { tree_id: string; kind: string; version_seq: number }[]
          >`
        select tree_id, kind, version_seq from organelle.trees
        where tree_id = ${treeId}
        for update
      `;
          if (source.length !== 1)
            return { ok: false as const, reason: "Version not found" };
          const src = source[0]!;
          const allowed = restoreSourceAllowed(src.kind);
          if (!allowed.ok) return allowed;

          const nextSeq = Number(pub.version_seq) + 1;
          const restoredSeq = Number(src.version_seq);

          await tx`
        update organelle.trees
        set kind = 'historical'
        where tree_id = ${pub.tree_id}
      `;

          const inserted = await tx<{ tree_id: string }[]>`
        insert into organelle.trees
          (kind, version_seq, created_by_auth_id, published_at)
        values ('published', ${nextSeq}, ${actor}, now())
        returning tree_id
      `;
          const newId = inserted[0]!.tree_id;

          await tx`
        insert into organelle.nodes
          (tree_id, node_id, parent_node_id, node_type, sort_order, name, job_title, position_level, is_assistant, leaf_grid_columns)
        select ${newId}, node_id, parent_node_id, node_type, sort_order, name, job_title, position_level, is_assistant, leaf_grid_columns
        from organelle.nodes
        where tree_id = ${treeId}
        order by nlevel(path)
      `;
          await tx`
        insert into organelle.seat_assignments
          (tree_id, node_id, employee_auth_id, is_host, is_primary, assigned_at)
        select ${newId}, node_id, employee_auth_id, is_host, is_primary, assigned_at
        from organelle.seat_assignments
        where tree_id = ${treeId}
      `;

          await tx`
        insert into organelle.change_log (tree_id, actor_auth_id, op, before, after)
        values (
          ${newId},
          ${actor},
          'restore_version',
          ${tx.json({ from_seq: restoredSeq })},
          ${tx.json({ restored_seq: restoredSeq, new_seq: nextSeq })}
        )
      `;

          await tx`select organelle.validate_tree(${newId})`;
          return { ok: true as const, treeId: newId };
        }),
      {
        logger: "versions.actions",
        operation: "restore_version",
        fields: {
          actor_auth_id: actor,
          actor_role: access.actor.role,
          tree_id: treeId,
        },
      },
    );
    logActionResult({
      logger: "versions.actions",
      operation: "restore_version",
      eventName: "versions.restore.result",
      result: result.ok ? "success" : "rejected",
      failureReason: result.ok ? undefined : result.reason,
      startedAt,
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        tree_id: treeId,
        restored_tree_id: result.ok ? result.treeId : undefined,
      },
    });
    return result;
  } catch (error) {
    logActionError({
      logger: "versions.actions",
      operation: "restore_version",
      eventName: "versions.restore.error",
      error,
      startedAt,
      fields: {
        actor_auth_id: actor,
        actor_role: access.actor.role,
        tree_id: treeId,
      },
    });
    throw error;
  }
}
