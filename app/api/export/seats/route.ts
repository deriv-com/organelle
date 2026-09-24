import { EXPORT_ROLES, requireRole, textNotAllowed } from "@/features/auth/session";
import { buildPublishedSeatExportCsv } from "@/features/reports/seat-export-query";
import { csvContentDisposition, organizationDateString } from "@/features/reports/csv";
import { logRouteError, logStart } from "@/lib/app-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const startedAt = logStart();
  const access = await requireRole(EXPORT_ROLES);
  if (!access.ok) {
    return textNotAllowed(access.status);
  }

  try {
    const csv = await buildPublishedSeatExportCsv();
    const filename = `organelle_report_${organizationDateString()}.csv`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": csvContentDisposition(filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logRouteError({
      logger: "reports.export",
      operation: "export_seats_csv",
      eventName: "reports.seats_export.error",
      error,
      httpMethod: "GET",
      httpPath: request.url,
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
      },
    });
    return new Response("Export failed", { status: 500 });
  }
}
