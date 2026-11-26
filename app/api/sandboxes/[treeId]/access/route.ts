import { checkRateLimit } from "@/lib/rate-limit";
import { requireActor } from "@/features/auth/session";
import { getSandboxAccess } from "@/features/sandbox/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ treeId: string }> },
) {
  const session = await requireActor();
  if (!session.ok) {
    return Response.json({ error: "Not allowed" }, { status: session.status });
  }

  const limit = checkRateLimit(`sandbox-access:${session.actor.authId}`, 60, 60_000);
  if (!limit.ok)
    return Response.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(limit.retryAfterSec),
          "Cache-Control": "no-store",
        },
      },
    );
  const { treeId } = await params;
  const access = await getSandboxAccess(treeId, session.actor);
  if (!access?.canView) {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }

  return Response.json(
    { canView: true, canReadHistory: access.canReadHistory },
    { headers: { "Cache-Control": "no-store" } },
  );
}
