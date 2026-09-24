"use server";

/**
 * Role grant/revoke. Admin only; absence of a row means viewer.
 */

import { withDbRetry } from "@/lib/db";
import {
  logActionError,
  logActionRejected,
  logActionResult,
  logStart,
} from "@/lib/app-logging";
import { UUID_RE } from "@/lib/uuid";
import { ADMIN_ROLES, requireRole } from "./session";
import { listRoleDirectoryRows } from "./role-directory";
import { clearRoleDirectoryCache } from "./role-cache";
import { APP_ROLES, canChangeAdminRole, type AppRole } from "./policy";
import type { RoleRow } from "./role-types";

export type { RoleRow } from "./role-types";

export async function listRoleDirectory(): Promise<RoleRow[] | { error: string }> {
  const access = await requireRole(ADMIN_ROLES);
  if (!access.ok) return { error: access.reason };
  return listRoleDirectoryRows();
}

export async function setRole(
  subjectAuthId: string,
  nextRole: AppRole,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const startedAt = logStart();
  if (!APP_ROLES.includes(nextRole)) {
    logActionRejected({
      logger: "auth.roles",
      operation: "set_role",
      eventName: "auth.role_set.result",
      failureReason: "Unknown role",
      startedAt,
      fields: { next_role: nextRole },
    });
    return { ok: false, reason: "Unknown role" };
  }
  if (!UUID_RE.test(subjectAuthId)) {
    logActionRejected({
      logger: "auth.roles",
      operation: "set_role",
      eventName: "auth.role_set.result",
      failureReason: "Unknown employee",
      startedAt,
      fields: {
        validation_target: "subject_auth_id",
        next_role: nextRole,
      },
    });
    return { ok: false, reason: "Unknown employee" };
  }
  const access = await requireRole(ADMIN_ROLES);
  if (!access.ok) {
    logActionRejected({
      logger: "auth.roles",
      operation: "set_role",
      eventName: "auth.role_set.result",
      failureReason: access.reason,
      startedAt,
      fields: {
        auth_status: access.status,
        subject_auth_id: subjectAuthId,
        next_role: nextRole,
      },
    });
    return access;
  }

  try {
    const result = await withDbRetry(
      async (sql) =>
        sql.begin(async (tx) => {
          const subject = await tx<{ auth_id: string }[]>`
        select auth_id from organelle.employees
        where auth_id = ${subjectAuthId}
          and sandbox_tree_id is null
        for update
      `;
          if (subject.length !== 1)
            return { ok: false as const, reason: "Unknown employee" };
          const existing = await tx<{ role: AppRole }[]>`
        select role from organelle.app_roles
        where auth_id = ${subjectAuthId}
        for update
      `;
          const current: AppRole = existing[0]?.role ?? "viewer";
          if (current === nextRole) return { ok: true as const };

          const adminRows = await tx<{ auth_id: string }[]>`
        select auth_id from organelle.app_roles
        where role = 'admin'
        for update
      `;
          if (!canChangeAdminRole(adminRows.length, current === "admin", nextRole)) {
            return { ok: false as const, reason: "Keep at least one admin" };
          }

          const published = await tx<{ tree_id: string }[]>`
        select tree_id from organelle.trees where kind = 'published'
      `;
          if (published.length !== 1)
            return { ok: false as const, reason: "No published tree" };
          const treeId = published[0]!.tree_id;
          const actor = access.actor.authId;

          if (nextRole === "viewer") {
            await tx`delete from organelle.app_roles where auth_id = ${subjectAuthId}`;
          } else if (current === "viewer") {
            await tx`
          insert into organelle.app_roles (auth_id, role, granted_by)
          values (${subjectAuthId}, ${nextRole}, ${actor})
        `;
          } else {
            await tx`
          update organelle.app_roles
          set role = ${nextRole}, granted_by = ${actor}, granted_at = now()
          where auth_id = ${subjectAuthId}
        `;
          }

          await tx`
        insert into organelle.change_log
          (tree_id, actor_auth_id, op, employee_auth_id, before, after)
        values (
          ${treeId},
          ${actor},
          ${nextRole === "viewer" ? "revoke_role" : "grant_role"},
          ${subjectAuthId},
          ${tx.json({ role: current })},
          ${tx.json({ role: nextRole })}
        )
      `;
          return { ok: true as const };
        }),
      {
        logger: "auth.roles",
        operation: "set_role",
        fields: {
          actor_auth_id: access.actor.authId,
          actor_role: access.actor.role,
          subject_auth_id: subjectAuthId,
          next_role: nextRole,
        },
      },
    );
    if (result.ok) clearRoleDirectoryCache();
    logActionResult({
      logger: "auth.roles",
      operation: "set_role",
      eventName: "auth.role_set.result",
      result: result.ok ? "success" : "rejected",
      failureReason: result.ok ? undefined : result.reason,
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
        subject_auth_id: subjectAuthId,
        next_role: nextRole,
      },
    });
    return result;
  } catch (error) {
    logActionError({
      logger: "auth.roles",
      operation: "set_role",
      eventName: "auth.role_set.error",
      error,
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
        subject_auth_id: subjectAuthId,
        next_role: nextRole,
      },
    });
    throw error;
  }
}
