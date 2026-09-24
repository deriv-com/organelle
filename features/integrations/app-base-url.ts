export const PRODUCTION_APP_BASE_URL = "https://organelle.example.com";

export const STRUCTURE_HEADERS_PATH = "/api/integrations/v1/structure/headers";

/** Public Integrations API URL (prod only — for external consumer docs). */
export const PRODUCTION_STRUCTURE_HEADERS_URL = `${PRODUCTION_APP_BASE_URL}${STRUCTURE_HEADERS_PATH}`;

/** Canonical app origin for redirects (sign-out returnTo). Never from request headers. */
export function getAppBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (env.NODE_ENV === "production") return PRODUCTION_APP_BASE_URL;
  return "http://localhost:3000";
}
