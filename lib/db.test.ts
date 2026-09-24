import { describe, expect, it } from "vitest";

import {
  DB_POOL_MAX,
  isRetryableDbError,
  productionDatabaseUrlRequiresSsl,
} from "./db";

describe("isRetryableDbError", () => {
  it("retries connection and network-down failures", () => {
    expect(isRetryableDbError("connect ENETDOWN 44.208.221.186:6543")).toBe(true);
    expect(isRetryableDbError("connect ECONNRESET")).toBe(true);
    expect(isRetryableDbError("connect ENETUNREACH")).toBe(true);
    expect(isRetryableDbError("write CONNECTION_CLOSED 44.208.221.186:6543")).toBe(
      true,
    );
    expect(isRetryableDbError("CONNECTION_CLOSED")).toBe(true);
    expect(isRetryableDbError("write CONNECTION_DESTROYED db.example.com:5432")).toBe(
      true,
    );
    expect(isRetryableDbError("getaddrinfo ENOTFOUND db.example.com")).toBe(true);
    expect(isRetryableDbError("getaddrinfo EAI_AGAIN")).toBe(true);
  });

  it("does not retry SQL errors", () => {
    expect(isRetryableDbError('column "sandbox_tree_id" does not exist')).toBe(false);
  });
});

describe("productionDatabaseUrlRequiresSsl", () => {
  it("requires an explicit sslmode in production URLs", () => {
    expect(productionDatabaseUrlRequiresSsl("postgresql://x/db")).toBe(false);
    expect(productionDatabaseUrlRequiresSsl("postgresql://x/db?sslmode=require")).toBe(
      true,
    );
    expect(
      productionDatabaseUrlRequiresSsl("postgresql://x/db?sslmode=verify-full"),
    ).toBe(true);
  });
});

describe("DB_POOL_MAX", () => {
  it("stays a modest client pool, not one connection per user", () => {
    expect(DB_POOL_MAX).toBeGreaterThanOrEqual(1);
    expect(DB_POOL_MAX).toBeLessThanOrEqual(50);
  });
});
