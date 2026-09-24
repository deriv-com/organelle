import { EDITOR_ROLES, hasAllowedRole, requireActor } from "@/features/auth/session";
import {
  listSandboxesForActor,
  listSharedSandboxesForActor,
} from "@/features/sandbox/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const access = await requireActor();
  if (!access.ok) {
    return Response.json({ error: "Not allowed" }, { status: access.status });
  }

  const canOwnSandbox = hasAllowedRole(access.actor.role, EDITOR_ROLES);
  const [owned, shared] = await Promise.all([
    canOwnSandbox ? listSandboxesForActor(access.actor.authId) : Promise.resolve([]),
    listSharedSandboxesForActor(access.actor.authId),
  ]);
  return Response.json(
    { owned, shared },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
