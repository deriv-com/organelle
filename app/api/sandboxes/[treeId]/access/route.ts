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

  const { treeId } = await params;
  const access = await getSandboxAccess(treeId, session.actor);
  if (!access?.canView) {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }

  return Response.json({ canView: true }, { headers: { "Cache-Control": "no-store" } });
}
