import { describe, expect, it } from "vitest";

import { API_KEY_LABEL_MAX_LEN } from "./api-key-label";
import { createApiKey } from "./api-keys-store";
import { STRUCTURE_HEADERS_READ } from "./scopes";

describe("createApiKey label validation", () => {
  it("rejects labels over 200 characters without hitting the database", async () => {
    const result = await createApiKey({
      label: "x".repeat(API_KEY_LABEL_MAX_LEN + 1),
      scopes: [STRUCTURE_HEADERS_READ],
      createdBy: "00000000-0000-4000-8000-000000000001",
    });
    expect(result).toEqual({
      error: `Label must be ${API_KEY_LABEL_MAX_LEN} characters or less`,
    });
  });

  it("rejects empty labels after trim", async () => {
    const result = await createApiKey({
      label: "   ",
      scopes: [STRUCTURE_HEADERS_READ],
      createdBy: "00000000-0000-4000-8000-000000000001",
    });
    expect(result).toEqual({ error: "Label is required" });
  });
});
