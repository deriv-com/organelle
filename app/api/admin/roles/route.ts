import { listCachedRoleDirectoryRows } from "@/features/auth/role-directory";
import { ADMIN_ROLES, requireRole } from "@/features/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const startedAt = performance.now();
  const authStartedAt = performance.now();
  const access = await requireRole(ADMIN_ROLES);
  const authMs = performance.now() - authStartedAt;

  if (!access.ok) {
    return Response.json(
      { error: "Not allowed" },
      {
        status: access.status,
        headers: {
          "Server-Timing": [
            `auth;dur=${authMs.toFixed(1)}`,
            `roles;dur=0.0`,
            `total;dur=${(performance.now() - startedAt).toFixed(1)}`,
          ].join(", "),
        },
      },
    );
  }

  const rolesStartedAt = performance.now();
  const result = await listCachedRoleDirectoryRows();
  const rolesMs = performance.now() - rolesStartedAt;
  const serverTiming = [
    `auth;dur=${authMs.toFixed(1)}`,
    `roles;dur=${rolesMs.toFixed(1)}`,
    `total;dur=${(performance.now() - startedAt).toFixed(1)}`,
  ].join(", ");

  return Response.json(result.rows, {
    headers: {
      "Cache-Control": "no-store",
      "Server-Timing": serverTiming,
      "X-Organelle-Roles-Cache": result.cache,
    },
  });
}
