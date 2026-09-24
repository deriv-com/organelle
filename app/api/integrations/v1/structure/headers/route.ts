import { checkRateLimit } from "@/lib/rate-limit";
import { jsonApiKeyDenied, requireApiKey } from "@/features/integrations/api-key-auth";
import { fetchPublishedHeaderTree } from "@/features/integrations/header-tree-query";
import { STRUCTURE_HEADERS_READ } from "@/features/integrations/scopes";
import { buildErrorLogFields, logEvent } from "@/lib/app-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await requireApiKey([STRUCTURE_HEADERS_READ], request);
  if (!access.ok) return jsonApiKeyDenied(access.status, access.reason);

  const limit = checkRateLimit(`integrations:${access.actor.keyId}`, 60, 60_000);
  if (!limit.ok) {
    return Response.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec) },
      },
    );
  }

  try {
    const { tree } = await fetchPublishedHeaderTree();
    return Response.json(
      { tree },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    logEvent({
      level: "error",
      logger: "integrations.structure.headers",
      message: "Failed to load published header tree",
      fields: {
        key_id: access.actor.keyId,
        ...buildErrorLogFields(error),
      },
    });
    return Response.json({ error: "Failed to load header tree" }, { status: 500 });
  }
}
