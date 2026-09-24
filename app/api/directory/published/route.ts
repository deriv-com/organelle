import { fetchPublishedDirectorySnapshot } from "@/features/directory/directory-data";
import { filterDirectoryRowsForRole } from "@/features/directory/directory-visibility";
import {
  directoryRowBatches,
  encodeDirectoryStreamMessage,
} from "@/features/directory/directory-stream";
import { jsonNotAllowed, requireActor } from "@/features/auth/session";
import { logRouteError, logStart } from "@/lib/app-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const startedAt = logStart();
  const access = await requireActor();
  if (!access.ok) return jsonNotAllowed(access.status);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const snapshot = await fetchPublishedDirectorySnapshot();
        const rows = filterDirectoryRowsForRole(snapshot.rows, access.actor.role);
        controller.enqueue(
          encoder.encode(
            encodeDirectoryStreamMessage({
              type: "meta",
              treeId: snapshot.treeId,
              versionSeq: snapshot.versionSeq,
              publishedAt: snapshot.publishedAt,
              total: rows.length,
              headers: snapshot.headers,
            }),
          ),
        );

        for (const batch of directoryRowBatches(rows)) {
          controller.enqueue(
            encoder.encode(encodeDirectoryStreamMessage({ type: "rows", rows: batch })),
          );
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        controller.enqueue(
          encoder.encode(encodeDirectoryStreamMessage({ type: "done" })),
        );
        controller.close();
      } catch (error) {
        logRouteError({
          logger: "directory.api",
          operation: "stream_published_directory",
          eventName: "directory.stream.error",
          error,
          httpMethod: "GET",
          httpPath: request.url,
          startedAt,
          fields: {
            actor_auth_id: access.actor.authId,
            actor_role: access.actor.role,
          },
        });
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}
