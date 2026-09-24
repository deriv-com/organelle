import { listApiKeys } from "@/features/integrations/api-keys-store";
import {
  ADMIN_ROLES,
  INTEGRATIONS_ROLES,
  hasAllowedRole,
  requireRole,
} from "@/features/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const access = await requireRole(INTEGRATIONS_ROLES);
  if (!access.ok) {
    return Response.json({ error: "Not allowed" }, { status: access.status });
  }

  const isAdmin = hasAllowedRole(access.actor.role, ADMIN_ROLES);
  const rows = await listApiKeys(isAdmin ? {} : { createdBy: access.actor.authId });
  return Response.json(rows, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
