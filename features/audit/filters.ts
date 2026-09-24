export const AUDIT_PAGE_SIZE = 50;

export type AuditScope = "published" | "sandbox" | "all";

export type AuditFilters = {
  scope: AuditScope;
  query: string;
  actor: string | null;
  op: string | null;
  page: number;
};

type SearchParamInput = URLSearchParams | Record<string, string | string[] | undefined>;

const SCOPES = new Set<AuditScope>(["published", "sandbox", "all"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OP_RE = /^[a-z][a-z0-9_]*$/;

function firstValue(
  input: SearchParamInput,
  key: "scope" | "q" | "actor" | "op" | "page",
): string | undefined {
  if (input instanceof URLSearchParams) return input.get(key) ?? undefined;
  const value = input[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

function normaliseSearch(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function auditSearchTokens(query: string): string[] {
  return [
    ...new Set(
      normaliseSearch(query)
        .toLowerCase()
        .split(/[^a-z0-9@.+-]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
        .slice(0, 8),
    ),
  ];
}

export function parseAuditFilters(input: SearchParamInput): AuditFilters {
  const rawScope = firstValue(input, "scope");
  const scope =
    rawScope && SCOPES.has(rawScope as AuditScope) ? (rawScope as AuditScope) : "all";

  const rawPage = Number.parseInt(firstValue(input, "page") ?? "", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawActor = firstValue(input, "actor")?.trim() ?? "";
  const actor =
    rawActor && rawActor !== "all" && UUID_RE.test(rawActor) ? rawActor : null;

  const rawOp = firstValue(input, "op")?.trim() ?? "";
  const op = rawOp && rawOp !== "all" && OP_RE.test(rawOp) ? rawOp : null;

  return {
    scope,
    query: normaliseSearch(firstValue(input, "q")),
    actor,
    op,
    page,
  };
}

export function auditOffset(page: number): number {
  return (Math.max(1, page) - 1) * AUDIT_PAGE_SIZE;
}
