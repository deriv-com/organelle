import type { TransactionSql } from "postgres";

import type { Actor } from "@/features/auth/policy";
import { UUID_RE } from "@/lib/uuid";
import { sandboxAccessWithSql } from "./access";

export { UUID_RE };

export async function lockEditableSandbox(
  tx: TransactionSql,
  treeId: string,
  actor: Actor,
): Promise<{ ok: false; reason: string } | null> {
  const access = await sandboxAccessWithSql(tx, treeId, actor, { lock: true });
  if (!access?.canEdit) return { ok: false, reason: "Not allowed" };
  return null;
}
