import { buildErrorLogFields, logEvent, logPathFromUrl } from "@/lib/app-logging";
import { assertSecureProductionConfig } from "@/lib/startup-config";

type OrganelleLoggingGlobal = typeof globalThis & {
  __organelleNoteRequestErrorLogged?: (digest: string) => void;
};

type RequestErrorRequest = {
  method?: string;
  path?: string;
  url?: string;
};

type RequestErrorContext = {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
  renderSource?: string;
  revalidateReason?: string;
};

export async function register() {
  assertSecureProductionConfig();
  // Dynamic import stays inside the nodejs branch so Edge webpack never pulls postgres/`net`.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerSystemHealthLogs } = await import("@/lib/system-health");
    registerSystemHealthLogs();
  }
}

export function onRequestError(
  error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext,
) {
  const method = request.method ?? "GET";
  const path = logPathFromUrl(request.path ?? request.url);

  logEvent({
    level: "error",
    logger: "next.request",
    message: `Server request error on ${method} ${path}`,
    fields: {
      http_method: method,
      http_path: path,
      http_status_code: 500,
      router_kind: context.routerKind,
      route_path: context.routePath,
      route_type: context.routeType,
      render_source: context.renderSource,
      revalidate_reason: context.revalidateReason,
      ...buildErrorLogFields(error),
    },
  });

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const digest =
      error instanceof Error &&
      typeof (error as Error & { digest?: string }).digest === "string"
        ? (error as Error & { digest?: string }).digest
        : undefined;
    if (digest) {
      (globalThis as OrganelleLoggingGlobal).__organelleNoteRequestErrorLogged?.(
        digest,
      );
    }
  }
}
