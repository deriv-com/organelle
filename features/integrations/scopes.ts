/**
 * Integrations API scopes.
 */

export const STRUCTURE_HEADERS_READ = "structure.headers.read" as const;

export const KNOWN_SCOPES = [STRUCTURE_HEADERS_READ] as const;

export type IntegrationScope = (typeof KNOWN_SCOPES)[number];

export function isKnownScope(value: string): value is IntegrationScope {
  return (KNOWN_SCOPES as readonly string[]).includes(value);
}

export function parseScopes(values: readonly string[]): IntegrationScope[] | null {
  if (values.length === 0) return null;
  const out: IntegrationScope[] = [];
  for (const value of values) {
    if (!isKnownScope(value)) return null;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

export function hasAllScopes(
  granted: readonly string[],
  required: readonly IntegrationScope[],
): boolean {
  return required.every((scope) => granted.includes(scope));
}
