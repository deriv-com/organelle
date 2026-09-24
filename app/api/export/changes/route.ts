import { EXPORT_ROLES, requireRole, textNotAllowed } from "@/features/auth/session";
import { buildChangesReport } from "@/features/reports/changes/build-report";
import { csvContentDisposition } from "@/features/reports/csv";
import { logActionRejected, logRouteError, logStart } from "@/lib/app-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const startedAt = logStart();
  const access = await requireRole(EXPORT_ROLES);
  if (!access.ok) {
    return textNotAllowed(access.status);
  }

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (!date || !DATE_RE.test(date)) {
    logActionRejected({
      logger: "reports.export",
      operation: "export_changes_csv",
      eventName: "reports.changes_export.result",
      failureReason: "Invalid date; use YYYY-MM-DD",
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
        date_present: Boolean(date),
        http_method: "GET",
        http_path: url.pathname,
        http_status_code: 400,
      },
    });
    return new Response("Invalid date; use YYYY-MM-DD", { status: 400 });
  }

  try {
    const report = await buildChangesReport(date);
    const filename = `organelle_changes_${date}.csv`;
    return new Response(report.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": csvContentDisposition(filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logRouteError({
      logger: "reports.export",
      operation: "export_changes_csv",
      eventName: "reports.changes_export.error",
      error,
      httpMethod: "GET",
      httpPath: request.url,
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
        report_date: date,
      },
    });
    return new Response("Export failed", { status: 500 });
  }
}
