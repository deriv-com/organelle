"use server";

import { withDbRetry } from "@/lib/db";
import { requireActor } from "@/features/auth/session";
import type { SeatMember } from "@/features/chart/chart-row";
import {
  memberPatchFromDraft,
  validateEmployeeDraft,
  validateSeatTitle,
  type EmployeeDraft,
} from "@/features/directory/employee-fields";
import { insertChangeLog } from "./change-log";
import {
  changedEmployeeSnapshot,
  employeeAuditSnapshotFromDraft,
  type EmployeeAuditRow,
} from "./employee-audit";
import { lockEditableSandbox, UUID_RE } from "./lock";

export type EmployeeWriteResult =
  { ok: true; patch: Partial<SeatMember> } | { ok: false; reason: string };

export async function updateEmployee(
  treeId: string,
  nodeId: string,
  employeeAuthId: string,
  draft: EmployeeDraft,
): Promise<EmployeeWriteResult> {
  if (!UUID_RE.test(treeId) || !UUID_RE.test(nodeId) || !UUID_RE.test(employeeAuthId)) {
    return { ok: false, reason: "Malformed id" };
  }
  const errors = validateEmployeeDraft(draft);
  if (Object.keys(errors).length > 0) {
    return { ok: false, reason: Object.values(errors)[0] ?? "Invalid employee" };
  }
  const access = await requireActor();
  if (!access.ok) return { ok: false, reason: "Not allowed" };
  const actor = access.actor.authId;
  const email = draft.email.trim() || null;
  const patch = memberPatchFromDraft(draft);

  return withDbRetry(async (sql) =>
    sql.begin(async (tx) => {
      const denied = await lockEditableSandbox(tx, treeId, access.actor);
      if (denied) return denied;
      //change: Verify the edit came from a real seat in this sandbox, then load the
      // current pending override when one already exists.
      const people = await tx<
        (EmployeeAuditRow & {
          override_auth_id: string | null;
          override_full_name: string | null;
          override_legal_full_name: string | null;
          override_id: string | null;
          override_employment_record: string | null;
          override_job_title: string | null;
          override_position_level: number | null;
          override_avatar_url: string | null;
          override_office_country: string | null;
          override_office_location: string | null;
          override_hiring_company: string | null;
          override_status: string | null;
          override_joining_date: string | null;
          override_hired_at: string | null;
          override_resignation_date: string | null;
          override_last_working_date: string | null;
          primary_manager_auth_id: string | null;
          primary_team_path: string | null;
          override_primary_manager_auth_id: string | null;
          override_primary_team_path: string | null;
        })[]
      >`
        select e.email,
               e.full_name,
               e.legal_full_name,
               e.id,
               e.employment_record,
               e.job_title,
               e.position_level,
               e.avatar_url,
               e.office_country,
               e.office_location,
               e.hiring_company,
               e.status::text as status,
               e.joining_date::text as joining_date,
               e.hired_at::text as hired_at,
               e.resignation_date::text as resignation_date,
               e.last_working_date::text as last_working_date,
               e.sandbox_tree_id,
               e.primary_manager_auth_id,
               e.primary_team_path,
               o.auth_id as override_auth_id,
               o.display_name as override_full_name,
               o.legal_full_name as override_legal_full_name,
               o.external_id as override_id,
               o.employment_record as override_employment_record,
               o.display_title as override_job_title,
               o.position_level as override_position_level,
               o.avatar_url as override_avatar_url,
               o.office_country as override_office_country,
               o.office_location as override_office_location,
               o.hiring_company as override_hiring_company,
               o.status::text as override_status,
               o.joining_date::text as override_joining_date,
               o.hired_at::text as override_hired_at,
               o.resignation_date::text as override_resignation_date,
               o.last_working_date::text as override_last_working_date,
               o.primary_manager_auth_id as override_primary_manager_auth_id,
               o.primary_team_path as override_primary_team_path
        from organelle.seat_assignments sa
        join organelle.employees original_employee
          on original_employee.auth_id = sa.employee_auth_id
        left join organelle.sandbox_employee_edits edits
          on edits.tree_id = sa.tree_id and edits.employee_auth_id = sa.employee_auth_id
        cross join lateral jsonb_populate_record(
          null::organelle.employees,
          to_jsonb(original_employee) || coalesce(edits.after_data, '{}'::jsonb)
        ) e
        left join organelle.employee_overrides o
          on o.tree_id = sa.tree_id and o.auth_id = sa.employee_auth_id
        where sa.tree_id = ${treeId}
          and sa.node_id = ${nodeId}
          and sa.employee_auth_id = ${employeeAuthId}
        for update of sa, original_employee
      `;
      if (people.length !== 1)
        return { ok: false as const, reason: "Unknown employee" };
      const person = people[0]!;
      const sandboxTreeId = person.sandbox_tree_id;
      if (sandboxTreeId != null && sandboxTreeId !== treeId) {
        return { ok: false as const, reason: "Unknown employee" };
      }
      const emailChanged =
        (email ?? "").toLowerCase() !== (person.email ?? "").toLowerCase();
      if (emailChanged && access.actor.role !== "admin") {
        return { ok: false as const, reason: "Only an administrator can change email" };
      }
      if (email != null) {
        const taken = await tx<{ auth_id: string }[]>`
          select auth_id from organelle.employees
          where lower(email) = lower(${email})
            and auth_id <> ${employeeAuthId}
          limit 1
        `;
        if (taken.length > 0)
          return { ok: false as const, reason: "That email is already in use" };
      }

      const hasOverride = person.override_auth_id != null;
      const before: EmployeeAuditRow = {
        email: person.email,
        full_name: hasOverride ? person.override_full_name : person.full_name,
        legal_full_name: hasOverride
          ? person.override_legal_full_name
          : person.legal_full_name,
        id: hasOverride ? person.override_id : person.id,
        employment_record: hasOverride
          ? person.override_employment_record
          : person.employment_record,
        job_title: hasOverride ? person.override_job_title : person.job_title,
        position_level: hasOverride
          ? person.override_position_level
          : person.position_level,
        avatar_url: hasOverride ? person.override_avatar_url : person.avatar_url,
        office_country: hasOverride
          ? person.override_office_country
          : person.office_country,
        office_location: hasOverride
          ? person.override_office_location
          : person.office_location,
        hiring_company: hasOverride
          ? person.override_hiring_company
          : person.hiring_company,
        status: hasOverride ? person.override_status : person.status,
        joining_date: hasOverride ? person.override_joining_date : person.joining_date,
        hired_at: hasOverride ? person.override_hired_at : person.hired_at,
        resignation_date: hasOverride
          ? person.override_resignation_date
          : person.resignation_date,
        last_working_date: hasOverride
          ? person.override_last_working_date
          : person.last_working_date,
        sandbox_tree_id: person.sandbox_tree_id,
      };
      const after = employeeAuditSnapshotFromDraft(draft, employeeAuthId, before);
      const changeSnapshot = changedEmployeeSnapshot(before, after);
      if (emailChanged) {
        await tx`
          update organelle.employees
          set email = ${email}, updated_at = now()
          where auth_id = ${employeeAuthId}
        `;
      }
      // Profile edits stay pending. The administrator-only identity email above is the
      // sole field intentionally written outside merge promotion.
      await tx`
        insert into organelle.employee_overrides (
          tree_id, node_id, auth_id, display_name, display_title, avatar_url,
          legal_full_name, office_country, office_location, hiring_company,
          status, joining_date, hired_at, resignation_date, last_working_date,
          external_id, employment_record, position_level,
          primary_manager_auth_id, primary_team_path, updated_by
        ) values (
          ${treeId}, ${nodeId}, ${employeeAuthId}, ${after.full_name}, ${after.job_title},
          ${after.avatar_url}, ${after.legal_full_name},
          ${after.office_country}, ${after.office_location}, ${after.hiring_company},
          ${after.status}, ${after.joining_date}, ${after.hired_at},
          ${after.resignation_date}, ${after.last_working_date}, ${after.id},
          ${after.employment_record}, ${after.position_level},
          ${hasOverride ? person.override_primary_manager_auth_id : person.primary_manager_auth_id},
          ${hasOverride ? person.override_primary_team_path : person.primary_team_path},
          ${actor}
        )
        on conflict (tree_id, auth_id) do update
        set node_id = excluded.node_id,
            display_name = excluded.display_name,
            display_title = excluded.display_title,
            avatar_url = excluded.avatar_url,
            legal_full_name = excluded.legal_full_name,
            office_country = excluded.office_country,
            office_location = excluded.office_location,
            hiring_company = excluded.hiring_company,
            status = excluded.status,
            joining_date = excluded.joining_date,
            hired_at = excluded.hired_at,
            resignation_date = excluded.resignation_date,
            last_working_date = excluded.last_working_date,
            external_id = excluded.external_id,
            employment_record = excluded.employment_record,
            position_level = excluded.position_level,
            primary_manager_auth_id = excluded.primary_manager_auth_id,
            primary_team_path = excluded.primary_team_path,
            updated_by = excluded.updated_by,
            updated_at = now()
      `;
      await insertChangeLog(tx, {
        treeId,
        actor,
        op: "update_employee",
        employeeAuthId,
        before: changeSnapshot.before,
        after: changeSnapshot.after,
        command: null,
      });
      return { ok: true as const, patch };
    }),
  );
}

export async function renameSeatTitle(
  treeId: string,
  nodeId: string,
  jobTitle: string,
): Promise<EmployeeWriteResult> {
  if (!UUID_RE.test(treeId) || !UUID_RE.test(nodeId)) {
    return { ok: false, reason: "Malformed id" };
  }
  const titleError = validateSeatTitle(jobTitle);
  if (titleError) return { ok: false, reason: titleError };
  const access = await requireActor();
  if (!access.ok) return { ok: false, reason: "Not allowed" };
  const actor = access.actor.authId;
  const nextTitle = jobTitle.trim();

  return withDbRetry(async (sql) =>
    sql.begin(async (tx) => {
      const denied = await lockEditableSandbox(tx, treeId, access.actor);
      if (denied) return denied;
      const nodes = await tx<{ job_title: string | null; node_type: string }[]>`
        select job_title, node_type from organelle.nodes
        where tree_id = ${treeId} and node_id = ${nodeId}
        for update
      `;
      if (nodes.length !== 1 || nodes[0]!.node_type !== "seat") {
        return { ok: false as const, reason: "Unknown seat" };
      }
      const before = nodes[0]!.job_title;
      await tx`
        update organelle.nodes
        set job_title = ${nextTitle}
        where tree_id = ${treeId} and node_id = ${nodeId}
      `;
      const primaries = await tx<{ employee_auth_id: string }[]>`
        select employee_auth_id from organelle.seat_assignments
        where tree_id = ${treeId} and node_id = ${nodeId} and is_primary
      `;
      for (const row of primaries) {
        await tx`select organelle.denormalize_primary(${treeId}, ${row.employee_auth_id}, ${actor})`;
      }
      await insertChangeLog(tx, {
        treeId,
        actor,
        op: "rename_seat",
        nodeId,
        before: { job_title: before },
        after: { job_title: nextTitle },
        command: null,
      });
      return { ok: true as const, patch: {} };
    }),
  );
}

export async function setPrimarySeat(
  treeId: string,
  nodeId: string,
  employeeAuthId: string,
): Promise<EmployeeWriteResult> {
  if (!UUID_RE.test(treeId) || !UUID_RE.test(nodeId) || !UUID_RE.test(employeeAuthId)) {
    return { ok: false, reason: "Malformed id" };
  }
  const access = await requireActor();
  if (!access.ok) return { ok: false, reason: "Not allowed" };
  const actor = access.actor.authId;

  return withDbRetry(async (sql) =>
    sql.begin(async (tx) => {
      const denied = await lockEditableSandbox(tx, treeId, access.actor);
      if (denied) return denied;
      const current = await tx<{ node_id: string }[]>`
        select node_id from organelle.seat_assignments
        where tree_id = ${treeId} and employee_auth_id = ${employeeAuthId} and is_primary
      `;
      const assignment = await tx<{ node_id: string }[]>`
        select node_id from organelle.seat_assignments
        where tree_id = ${treeId} and node_id = ${nodeId} and employee_auth_id = ${employeeAuthId}
        for update
      `;
      if (assignment.length !== 1)
        return { ok: false as const, reason: "Not on this seat" };
      await tx`
        update organelle.seat_assignments
        set is_primary = false
        where tree_id = ${treeId} and employee_auth_id = ${employeeAuthId} and is_primary
      `;
      await tx`
        update organelle.seat_assignments
        set is_primary = true
        where tree_id = ${treeId} and node_id = ${nodeId} and employee_auth_id = ${employeeAuthId}
      `;
      await tx`select organelle.denormalize_primary(${treeId}, ${employeeAuthId}, ${actor})`;
      await insertChangeLog(tx, {
        treeId,
        actor,
        op: "set_primary_seat",
        nodeId,
        employeeAuthId,
        before: { node_id: current[0]?.node_id ?? null },
        after: { node_id: nodeId },
        command: null,
      });
      const person = await tx<
        {
          job_title: string | null;
          primary_manager_auth_id: string | null;
          primary_team_path: string | null;
          override_job_title: string | null;
          override_primary_manager_auth_id: string | null;
          override_primary_team_path: string | null;
        }[]
      >`
        select effective.job_title,
               effective.primary_manager_auth_id,
               effective.primary_team_path,
               o.display_title as override_job_title,
               o.primary_manager_auth_id as override_primary_manager_auth_id,
               o.primary_team_path as override_primary_team_path
        from organelle.employees e
        left join organelle.sandbox_employee_edits se
          on se.employee_auth_id = e.auth_id and se.tree_id = ${treeId}
        cross join lateral jsonb_populate_record(null::organelle.employees,
          to_jsonb(e) || coalesce(se.after_data, '{}'::jsonb)) effective
        left join organelle.employee_overrides o
          on o.tree_id = ${treeId} and o.auth_id = e.auth_id
        where e.auth_id = ${employeeAuthId}
      `;
      const row = person[0];
      return {
        ok: true as const,
        patch: {
          displayTitle: row?.override_job_title ?? row?.job_title ?? "",
          isPrimary: true,
          primaryManagerAuthId:
            row?.override_primary_manager_auth_id ??
            row?.primary_manager_auth_id ??
            null,
          primaryTeamPath:
            row?.override_primary_team_path ?? row?.primary_team_path ?? null,
        },
      };
    }),
  );
}
