import { describe, expect, it } from "vitest";

import type { AuditFilters } from "./filters";
import {
  AUDIT_CLIENT_CACHE_TTL_MS,
  auditCacheKey,
  clearAuditClientCache,
  getCachedAuditPayload,
  rememberAuditPayload,
  type AuditPayload,
} from "./audit-client-cache";

const filters: AuditFilters = {
  scope: "published",
  query: "move",
  actor: null,
  op: "move_node",
  page: 2,
};

function payload(overrides: Partial<AuditPayload> = {}): AuditPayload {
  return {
    filters,
    data: { rows: [], total: 0, page: 2, pageCount: 1 },
    actors: [],
    ops: [],
    ...overrides,
  };
}

describe("audit client cache", () => {
  it("keys each filter and page combination separately", () => {
    expect(auditCacheKey(filters)).not.toBe(auditCacheKey({ ...filters, page: 1 }));
    expect(auditCacheKey(filters)).not.toBe(
      auditCacheKey({ ...filters, scope: "sandbox" }),
    );
  });

  it("returns cached payloads with freshness", () => {
    clearAuditClientCache();
    rememberAuditPayload(payload(), 1000);

    expect(
      getCachedAuditPayload(filters, 1000 + AUDIT_CLIENT_CACHE_TTL_MS - 1),
    ).toMatchObject({ fresh: true });
    expect(
      getCachedAuditPayload(filters, 1000 + AUDIT_CLIENT_CACHE_TTL_MS + 1),
    ).toMatchObject({ fresh: false });
  });
});
