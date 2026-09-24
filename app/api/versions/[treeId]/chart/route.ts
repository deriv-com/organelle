import { RESTORE_ROLES, requireRole } from "@/features/auth/session";
import { fetchVersionChartSnapshot } from "@/features/versions/version-chart-data";
import { logActionRejected, logStart } from "@/lib/app-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { UUID_RE } from "@/lib/uuid";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ treeId: string }> },
) {
  const startedAt = logStart();
  const access = await requireRole(RESTORE_ROLES);
  if (!access.ok) {
    logActionRejected({
      logger: "versions.api",
      operation: "load_version_chart",
      eventName: "versions.chart.result",
      failureReason: "Not allowed",
      startedAt,
      fields: {
        auth_status: access.status,
        http_method: "GET",
        http_path: new URL(request.url).pathname,
        http_status_code: access.status,
      },
    });
    return Response.json({ error: "Not allowed" }, { status: access.status });
  }

  const { treeId } = await params;
  if (!UUID_RE.test(treeId)) {
    logActionRejected({
      logger: "versions.api",
      operation: "load_version_chart",
      eventName: "versions.chart.result",
      failureReason: "Malformed id",
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
        validation_target: "tree_id",
        http_method: "GET",
        http_path: new URL(request.url).pathname,
        http_status_code: 400,
      },
    });
    return Response.json({ error: "Malformed id" }, { status: 400 });
  }

  const snapshot = await fetchVersionChartSnapshot(treeId);
  if (!snapshot) {
    logActionRejected({
      logger: "versions.api",
      operation: "load_version_chart",
      eventName: "versions.chart.result",
      failureReason: "Version not found",
      startedAt,
      fields: {
        actor_auth_id: access.actor.authId,
        actor_role: access.actor.role,
        tree_id: treeId,
        http_method: "GET",
        http_path: new URL(request.url).pathname,
        http_status_code: 404,
      },
    });
    return Response.json({ error: "Version not found" }, { status: 404 });
  }

  return Response.json(snapshot, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
