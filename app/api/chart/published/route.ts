import { fetchPublishedChartSnapshot } from "@/features/chart/chart-data";
import { jsonNotAllowed, requireActor } from "@/features/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const access = await requireActor();
  if (!access.ok) return jsonNotAllowed(access.status);

  const snapshot = await fetchPublishedChartSnapshot();
  return Response.json(snapshot, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
