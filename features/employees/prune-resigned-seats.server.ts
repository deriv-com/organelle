/**
 * After status is resigned, delete non-root seats whose remaining assignees
 * are all resigned and splice children to the parent.
 */

import type { Sql, TransactionSql } from "postgres";

import { insertChangeLog } from "@/features/sandbox/change-log";

export function isResignedEmptySeat(args: {
  parentId: string | "";
  assignmentStatuses: Array<string | null>;
}): boolean {
  if (args.parentId === "") return false;
  if (args.assignmentStatuses.length === 0) return false;
  return args.assignmentStatuses.every((status) => status === "resigned");
}

type Candidate = {
  node_id: string;
  parent_node_id: string;
  sort_order: number;
  job_title: string | null;
  host_auth_id: string | null;
};

async function resequence(
  tx: TransactionSql,
  treeId: string,
  orderedIds: string[],
): Promise<void> {
  if (orderedIds.length === 0) return;
  await tx`
    update organelle.nodes n
       set sort_order = v.ord - 1
      from unnest(${orderedIds}::uuid[]) with ordinality as v(node_id, ord)
     where n.tree_id = ${treeId}
       and n.node_id = v.node_id
       and n.sort_order <> v.ord - 1
  `;
}

async function pruneOne(
  tx: TransactionSql,
  treeId: string,
  actorAuthId: string,
  seat: Candidate,
): Promise<void> {
  const nodeId = seat.node_id;
  const grandparentId = seat.parent_node_id;
  const children = (await tx`
    select node_id from organelle.nodes
    where tree_id = ${treeId} and parent_node_id = ${nodeId}
    order by sort_order
  `) as unknown as { node_id: string }[];
  const childIds = children.map((child) => child.node_id);
  const members = (await tx`
    select employee_auth_id from organelle.seat_assignments
    where tree_id = ${treeId} and node_id = ${nodeId}
  `) as unknown as { employee_auth_id: string }[];
  const memberIds = members.map((row) => row.employee_auth_id);
  const siblings = (await tx`
    select node_id, sort_order from organelle.nodes
    where tree_id = ${treeId} and parent_node_id = ${grandparentId}
    order by sort_order
  `) as unknown as { node_id: string; sort_order: number }[];
  const order = siblings.map((row) => row.node_id);
  const currentIndex = order.indexOf(nodeId);
  const insertAt =
    currentIndex >= 0 ? currentIndex : Math.min(seat.sort_order, order.length);
  const currentSortOrder =
    currentIndex >= 0 ? siblings[currentIndex]!.sort_order : seat.sort_order;
  order.splice(insertAt, currentIndex >= 0 ? 1 : 0, ...childIds);

  if (childIds.length > 0) {
    await tx`
      update organelle.nodes set parent_node_id = ${grandparentId}
      where tree_id = ${treeId} and parent_node_id = ${nodeId}
    `;
  }

  await insertChangeLog(tx, {
    treeId,
    actor: actorAuthId,
    op: "delete_seat",
    nodeId,
    employeeAuthId: seat.host_auth_id,
    before: {
      parent_node_id: grandparentId,
      sort_order: currentSortOrder,
      job_title: seat.job_title,
      members: memberIds,
    },
    after: { reparented: childIds },
    command: null,
  });

  await tx`
    delete from organelle.nodes
    where tree_id = ${treeId} and node_id = ${nodeId}
  `;
  await resequence(tx, treeId, order);
  for (const authId of memberIds) {
    await tx`select organelle.ensure_one_primary(${treeId}, ${authId})`;
  }
}

async function loadCandidates(
  tx: TransactionSql,
  treeId: string,
): Promise<Candidate[]> {
  return (await tx`
    select n.node_id::text,
           n.parent_node_id::text,
           n.sort_order,
           n.job_title,
           (array_agg(sa.employee_auth_id order by sa.is_host desc, sa.assigned_at))[1]::text
             as host_auth_id
      from organelle.nodes n
      join organelle.seat_assignments sa
        on sa.tree_id = n.tree_id and sa.node_id = n.node_id
      join organelle.employees e on e.auth_id = sa.employee_auth_id
      left join organelle.employee_overrides o
        on o.tree_id = n.tree_id and o.auth_id = sa.employee_auth_id
      left join organelle.sandbox_employee_edits edits
        on edits.tree_id = sa.tree_id and edits.employee_auth_id = sa.employee_auth_id
     where n.tree_id = ${treeId}
       and n.node_type = 'seat'
       and n.parent_node_id is not null
     group by n.node_id, n.parent_node_id, n.sort_order, n.job_title, n.path
    having bool_and(
      coalesce(
        o.status,
        (edits.after_data->>'status')::organelle.employee_status,
        e.status
      ) = 'resigned'::organelle.employee_status
    )
     order by nlevel(n.path) desc
  `) as unknown as Candidate[];
}

export async function pruneResignedEmptySeatsTx(
  tx: TransactionSql,
  treeId: string,
  actorAuthId: string,
): Promise<number> {
  const candidates = await loadCandidates(tx, treeId);
  for (const candidate of candidates) {
    await pruneOne(tx, treeId, actorAuthId, candidate);
  }
  if (candidates.length > 0) {
    await tx`select organelle.validate_tree(${treeId})`;
  }
  return candidates.length;
}

export async function pruneResignedEmptySeats(
  sql: Sql,
  treeId: string,
  actorAuthId: string,
): Promise<number> {
  return sql.begin((tx) => pruneResignedEmptySeatsTx(tx, treeId, actorAuthId));
}
