/**
 * Actor attribution for change report rows.
 */

import "server-only";

import { withDbRetry } from "@/lib/db";

export async function fetchSeatActors(args: {
  nodeIds: string[];
  sandboxTreeIds: string[];
  mergerBySandbox: Map<string, { authId: string; name: string; email: string }>;
}): Promise<Map<string, { authId: string; name: string; email: string }>> {
  if (args.nodeIds.length === 0) return new Map();

  return withDbRetry(async (sql) => {
    const rows = await sql<
      {
        node_id: string;
        actor_auth_id: string;
        full_name: string | null;
        email: string | null;
        tree_id: string;
      }[]
    >`
      select cl.node_id, cl.actor_auth_id, e.full_name, e.email, cl.tree_id
      from organelle.change_log cl
      join organelle.employees e on e.auth_id = cl.actor_auth_id
      where cl.node_id = any(${args.nodeIds}::uuid[])
        and cl.tree_id = any(${args.sandboxTreeIds}::uuid[])
        and cl.op in (
          'move_node', 'create_seat', 'delete_seat', 'assign_employee',
          'unassign_employee', 'set_peer_host', 'reorder_node'
        )
      order by cl.created_at asc
    `;

    const out = new Map<string, { authId: string; name: string; email: string }>();
    for (const row of rows) {
      if (!row.node_id) continue;
      out.set(row.node_id, {
        authId: row.actor_auth_id,
        name: row.full_name ?? "Unknown",
        email: row.email ?? "",
      });
    }

    for (const [nodeId, actor] of out) {
      if (actor.name !== "Unknown") continue;
      const sandboxId = rows.find((r) => r.node_id === nodeId)?.tree_id;
      if (sandboxId) {
        const merger = args.mergerBySandbox.get(sandboxId);
        if (merger) out.set(nodeId, merger);
      }
    }

    for (const nodeId of args.nodeIds) {
      if (out.has(nodeId)) continue;
      const merger = args.mergerBySandbox.values().next().value;
      if (merger) out.set(nodeId, merger);
    }

    return out;
  });
}

export async function fetchMergerNames(
  authIds: string[],
): Promise<Map<string, { name: string; email: string }>> {
  if (authIds.length === 0) return new Map();
  return withDbRetry(async (sql) => {
    const rows = await sql<
      { auth_id: string; full_name: string | null; email: string | null }[]
    >`
      select auth_id, full_name, email from organelle.employees
      where auth_id = any(${authIds}::uuid[])
    `;
    return new Map(
      rows.map((r) => [
        r.auth_id,
        {
          name: r.full_name ?? "Unknown",
          email: r.email ?? "",
        },
      ]),
    );
  });
}
