import { ADMIN_ROLES, jsonNotAllowed, requireRole } from "@/features/auth/session";
import { parseAuditFilters } from "@/features/audit/filters";
import {
  listAuditActors,
  listAuditEvents,
  listAuditOps,
} from "@/features/audit/queries";
import { logRouteError, logStart } from "@/lib/app-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const startedAt = logStart();
  const access = await requireRole(ADMIN_ROLES);
  if (!access.ok) return jsonNotAllowed(access.status);

  try {
    const filters = parseAuditFilters(new URL(request.url).searchParams);
    const [data, actors, ops] = await Promise.all([
      listAuditEvents(filters),
      listAuditActors(),
      listAuditOps(),
    ]);
    return Response.json(
      { filters, data, actors, ops },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logRouteError({
      logger: "audit.api",
      operation: "list_audit_events",
      eventName: "audit.list.error",
      error,
      httpMethod: "GET",
      httpPath: request.url,
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
      },
    });
    return Response.json({ error: "Failed to load audit log" }, { status: 500 });
  }
}
