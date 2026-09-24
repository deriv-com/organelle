import { requireActor, jsonNotAllowed } from "@/features/auth/session";
import { parseClientEventBody } from "@/features/telemetry/client-event";
import { logEvent } from "@/lib/app-logging";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const access = await requireActor();
  if (!access.ok) return jsonNotAllowed(access.status);

  const text = await request.text();
  const parsed = parseClientEventBody(text);
  if (!parsed.ok) {
    return new Response(null, { status: parsed.status });
  }

  const limit = checkRateLimit(`client-events:${access.actor.authId}`, 20, 60_000);
  if (!limit.ok) {
    return new Response(null, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSec) },
    });
  }

  logEvent({
    level: parsed.event.type === "chunk_load_error" ? "error" : "warning",
    logger: "client.events",
    message: parsed.event.message || parsed.event.type,
    fields: {
      event_type: parsed.event.type,
      pathname: parsed.event.pathname,
      stack: parsed.event.stack || undefined,
      actor_auth_id: access.actor.authId,
    },
  });

  return new Response(null, { status: 204 });
}
