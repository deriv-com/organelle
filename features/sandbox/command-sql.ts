/**
 * Apply a command's log rows to the tree inside an open transaction.
 * Used by undoLast / redoLast — not by user mutations (those have their own SQL).
 */

import type { TransactionSql } from "postgres";

import type { CommandLogRow } from "./command-stack";
import {
  deleteDraftEmployeeIfOrphaned,
  ensureDraftEmployee,
  type DraftEmployeeSnapshot,
} from "./draft-employees";

async function resequenceSiblings(
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

function parentOf(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function sortOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function ensurePrimary(
  tx: TransactionSql,
  treeId: string,
  authId: string | null | undefined,
): Promise<void> {
  if (!authId) return;
  await tx`select organelle.ensure_one_primary(${treeId}, ${authId})`;
}

async function siblingIds(
  tx: TransactionSql,
  treeId: string,
  parentId: string | null,
  except?: string,
): Promise<string[]> {
  if (parentId === null) {
    const rows = (await tx`
      select node_id from organelle.nodes
      where tree_id = ${treeId} and parent_node_id is null
      order by sort_order
    `) as unknown as { node_id: string }[];
    return rows.map((row) => row.node_id).filter((id) => id !== except);
  }
  const rows = (await tx`
    select node_id from organelle.nodes
    where tree_id = ${treeId} and parent_node_id = ${parentId}
    order by sort_order
  `) as unknown as { node_id: string }[];
  return rows.map((row) => row.node_id).filter((id) => id !== except);
}

async function placeNode(
  tx: TransactionSql,
  treeId: string,
  nodeId: string,
  newParentId: string | null,
  sortOrder: number,
  touched: Set<string>,
): Promise<void> {
  const [node] = (await tx`
    select parent_node_id, sort_order from organelle.nodes
    where tree_id = ${treeId} and node_id = ${nodeId}
    for update
  `) as unknown as { parent_node_id: string | null; sort_order: number }[];
  if (!node) return;
  const oldParentId = node.parent_node_id;
  const order = await siblingIds(tx, treeId, newParentId, nodeId);
  const insertAt = Math.max(0, Math.min(sortOrder, order.length));
  order.splice(insertAt, 0, nodeId);
  await tx`
    update organelle.nodes
       set parent_node_id = ${newParentId}, sort_order = ${insertAt}
     where tree_id = ${treeId} and node_id = ${nodeId}
  `;
  await resequenceSiblings(tx, treeId, order);
  order.forEach((id) => touched.add(id));
  if (oldParentId !== newParentId && oldParentId) {
    const oldOrder = await siblingIds(tx, treeId, oldParentId);
    await resequenceSiblings(tx, treeId, oldOrder);
    oldOrder.forEach((id) => touched.add(id));
  }
}

async function deleteNodeSql(
  tx: TransactionSql,
  treeId: string,
  nodeId: string,
  touched: Set<string>,
): Promise<void> {
  const [node] = (await tx`
    select parent_node_id, sort_order from organelle.nodes
    where tree_id = ${treeId} and node_id = ${nodeId}
    for update
  `) as unknown as { parent_node_id: string | null; sort_order: number }[];
  if (!node || node.parent_node_id === null) return;
  const grandparentId = node.parent_node_id;
  const children = (await tx`
    select node_id from organelle.nodes
    where tree_id = ${treeId} and parent_node_id = ${nodeId}
    order by sort_order
  `) as unknown as { node_id: string }[];
  const childIds = children.map((child) => child.node_id);
  const order = await siblingIds(tx, treeId, grandparentId, nodeId);
  const insertAt = Math.min(node.sort_order, order.length);
  order.splice(insertAt, 0, ...childIds);
  if (childIds.length > 0) {
    await tx`
      update organelle.nodes set parent_node_id = ${grandparentId}
      where tree_id = ${treeId} and parent_node_id = ${nodeId}
    `;
  }
  const members = (await tx`
    select employee_auth_id from organelle.seat_assignments
    where tree_id = ${treeId} and node_id = ${nodeId}
  `) as unknown as { employee_auth_id: string }[];
  await tx`
    delete from organelle.nodes
    where tree_id = ${treeId} and node_id = ${nodeId}
  `;
  for (const member of members) {
    await ensurePrimary(tx, treeId, member.employee_auth_id);
    await deleteDraftEmployeeIfOrphaned(tx, treeId, member.employee_auth_id);
  }
  await resequenceSiblings(tx, treeId, order);
  order.forEach((id) => touched.add(id));
  touched.delete(nodeId);
}

async function restoreDeleted(
  tx: TransactionSql,
  treeId: string,
  entry: CommandLogRow,
  touched: Set<string>,
): Promise<void> {
  const nodeId = entry.node_id;
  if (!nodeId) return;
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const parentId = parentOf(before.parent_node_id);
  const sortOrder = sortOf(before.sort_order);
  const isHeader = entry.op === "delete_header";
  const name = isHeader ? String(before.name ?? "Team") : null;
  const jobTitle = isHeader ? null : String(before.job_title ?? "New position");
  const memberIds = Array.isArray(before.members)
    ? before.members.map(String)
    : entry.employee_auth_id
      ? [entry.employee_auth_id]
      : [];
  const reparented = Array.isArray(after.reparented)
    ? after.reparented.map(String)
    : [];

  const order = await siblingIds(tx, treeId, parentId);
  const insertAt = Math.max(0, Math.min(sortOrder, order.length));
  order.splice(insertAt, 0, nodeId);

  await tx`
    insert into organelle.nodes
      (tree_id, node_id, parent_node_id, node_type, sort_order, name, job_title)
    values (
      ${treeId}, ${nodeId}, ${parentId},
      ${isHeader ? "header" : "seat"}, ${insertAt}, ${name}, ${jobTitle}
    )
  `;
  await resequenceSiblings(tx, treeId, order);
  order.forEach((id) => touched.add(id));

  if (reparented.length > 0) {
    await tx`
      update organelle.nodes
         set parent_node_id = ${nodeId}
       where tree_id = ${treeId}
         and node_id = any(${reparented}::uuid[])
    `;
    await resequenceSiblings(tx, treeId, reparented);
    reparented.forEach((id) => touched.add(id));
  }

  for (let i = 0; i < memberIds.length; i++) {
    const authId = memberIds[i]!;
    const drafts = before.draft_employees;
    if (drafts && typeof drafts === "object" && !Array.isArray(drafts)) {
      const snap = (drafts as Record<string, DraftEmployeeSnapshot>)[authId];
      if (snap) await ensureDraftEmployee(tx, treeId, snap);
    }
    await tx`
      insert into organelle.seat_assignments
        (tree_id, node_id, employee_auth_id, is_host)
      values (${treeId}, ${nodeId}, ${authId}, ${i === 0})
      on conflict do nothing
    `;
    await ensurePrimary(tx, treeId, authId);
  }
}

async function createNodeSql(
  tx: TransactionSql,
  treeId: string,
  entry: CommandLogRow,
  touched: Set<string>,
): Promise<void> {
  const nodeId = entry.node_id;
  if (!nodeId) return;
  const after = entry.after ?? {};
  const parentId = parentOf(after.parent_node_id);
  const sortOrder = sortOf(after.sort_order);
  const isHeader = entry.op === "create_header";
  const name = isHeader ? String(after.name ?? "Team") : null;
  const jobTitle = isHeader ? null : String(after.job_title ?? "New position");
  const isAssistant = !isHeader && Boolean(after.is_assistant);
  const order = await siblingIds(tx, treeId, parentId);
  const insertAt = Math.max(0, Math.min(sortOrder, order.length));
  order.splice(insertAt, 0, nodeId);
  await tx`
    insert into organelle.nodes
      (tree_id, node_id, parent_node_id, node_type, sort_order, name, job_title, is_assistant)
    values (
      ${treeId}, ${nodeId}, ${parentId},
      ${isHeader ? "header" : "seat"}, ${insertAt}, ${name}, ${jobTitle}, ${isAssistant}
    )
  `;
  await resequenceSiblings(tx, treeId, order);
  order.forEach((id) => touched.add(id));
  if (!isHeader && entry.employee_auth_id) {
    const draft = after.draft_employee;
    if (draft && typeof draft === "object" && !Array.isArray(draft)) {
      await ensureDraftEmployee(tx, treeId, draft as DraftEmployeeSnapshot);
    }
    await tx`
      insert into organelle.seat_assignments
        (tree_id, node_id, employee_auth_id, is_host)
      values (${treeId}, ${nodeId}, ${entry.employee_auth_id}, true)
      on conflict do nothing
    `;
    await ensurePrimary(tx, treeId, entry.employee_auth_id);
  }
}

async function applyOp(
  tx: TransactionSql,
  treeId: string,
  entry: CommandLogRow,
  direction: "forward" | "inverse",
  touched: Set<string>,
): Promise<void> {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const target = direction === "forward" ? after : before;
  const nodeId = entry.node_id;

  switch (entry.op) {
    case "move_node":
    case "reorder_node":
      if (!nodeId) return;
      await placeNode(
        tx,
        treeId,
        nodeId,
        parentOf(target.parent_node_id),
        sortOf(target.sort_order),
        touched,
      );
      if ("is_assistant" in target) {
        await tx`
          update organelle.nodes
             set is_assistant = ${Boolean(target.is_assistant)}
           where tree_id = ${treeId} and node_id = ${nodeId}
        `;
        touched.add(nodeId);
      }
      return;
    case "set_assistant":
      if (!nodeId) return;
      await tx`
        update organelle.nodes
           set is_assistant = ${Boolean(target.is_assistant)}
         where tree_id = ${treeId} and node_id = ${nodeId}
      `;
      touched.add(nodeId);
      return;
    case "set_leaf_grid_columns":
      if (!nodeId) return;
      await tx`
        update organelle.nodes
           set leaf_grid_columns = ${Number(target.leaf_grid_columns ?? 3)}
         where tree_id = ${treeId} and node_id = ${nodeId}
      `;
      touched.add(nodeId);
      return;
    case "rename_header":
      if (!nodeId) return;
      await tx`
        update organelle.nodes
           set name = ${String(target.name ?? "")}
         where tree_id = ${treeId} and node_id = ${nodeId}
      `;
      touched.add(nodeId);
      return;
    case "create_header":
    case "create_seat":
      if (direction === "forward") await createNodeSql(tx, treeId, entry, touched);
      else if (nodeId) await deleteNodeSql(tx, treeId, nodeId, touched);
      return;
    case "delete_header":
    case "delete_seat":
      if (direction === "forward") {
        if (nodeId) await deleteNodeSql(tx, treeId, nodeId, touched);
      } else {
        await restoreDeleted(tx, treeId, entry, touched);
      }
      return;
    case "assign_employee":
      if (!nodeId || !entry.employee_auth_id) return;
      if (direction === "forward") {
        await tx`
          insert into organelle.seat_assignments
            (tree_id, node_id, employee_auth_id, is_host)
          values (
            ${treeId}, ${nodeId}, ${entry.employee_auth_id},
            ${Boolean(after.is_host)}
          )
          on conflict do nothing
        `;
        await tx`select organelle.ensure_one_primary(${treeId}, ${entry.employee_auth_id})`;
        touched.add(nodeId);
      } else {
        await tx`
          delete from organelle.seat_assignments
          where tree_id = ${treeId}
            and node_id = ${nodeId}
            and employee_auth_id = ${entry.employee_auth_id}
        `;
        await ensurePrimary(tx, treeId, entry.employee_auth_id);
        touched.add(nodeId);
      }
      return;
    case "unassign_employee":
      if (!nodeId || !entry.employee_auth_id) return;
      if (direction === "forward") {
        await tx`
          delete from organelle.seat_assignments
          where tree_id = ${treeId}
            and node_id = ${nodeId}
            and employee_auth_id = ${entry.employee_auth_id}
        `;
        touched.add(nodeId);
      } else {
        await tx`
          insert into organelle.seat_assignments
            (tree_id, node_id, employee_auth_id, is_host)
          values (
            ${treeId}, ${nodeId}, ${entry.employee_auth_id},
            ${Boolean(before.is_host)}
          )
          on conflict do nothing
        `;
        touched.add(nodeId);
      }
      return;
    case "set_peer_host": {
      if (!nodeId) return;
      const hostId =
        direction === "forward"
          ? entry.employee_auth_id
          : typeof before.previous_host === "string"
            ? before.previous_host
            : null;
      if (!hostId) return;
      await tx`
        update organelle.seat_assignments
           set is_host = false
         where tree_id = ${treeId} and node_id = ${nodeId} and is_host
      `;
      await tx`
        update organelle.seat_assignments
           set is_host = true
         where tree_id = ${treeId}
           and node_id = ${nodeId}
           and employee_auth_id = ${hostId}
      `;
      touched.add(nodeId);
    }
  }
}

export async function applyCommandSql(
  tx: TransactionSql,
  treeId: string,
  log: CommandLogRow[],
  direction: "forward" | "inverse",
): Promise<string[]> {
  const touched = new Set<string>();
  const ordered = direction === "inverse" ? [...log].reverse() : log;
  for (const entry of ordered) {
    await applyOp(tx, treeId, entry, direction, touched);
  }
  const authIds = new Set<string>();
  for (const entry of log) {
    if (entry.employee_auth_id) authIds.add(entry.employee_auth_id);
  }
  for (const authId of authIds) {
    await deleteDraftEmployeeIfOrphaned(tx, treeId, authId);
  }
  return [...touched];
}
