import { describe, expect, it } from "vitest";

import {
  PRODUCTION_APP_BASE_URL,
  PRODUCTION_STRUCTURE_HEADERS_URL,
  STRUCTURE_HEADERS_PATH,
} from "./app-base-url";

describe("production Integrations URLs", () => {
  it("documents the prod headers endpoint for external consumers", () => {
    expect(PRODUCTION_APP_BASE_URL).toBe("https://organelle.example.com");
    expect(PRODUCTION_STRUCTURE_HEADERS_URL).toBe(
      `https://organelle.example.com${STRUCTURE_HEADERS_PATH}`,
    );
  });
});
