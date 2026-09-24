import { describe, expect, it } from "vitest";

import { redactSensitiveText } from "./redaction";

describe("log redaction", () => {
  it.each([
    '{"password":"hunter2"}',
    '{"client_secret":"hunter2"}',
    "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4R0NNIn0..cipher.tag.value",
    "org_live_abcdefghijklmnopqrstuvwxyz",
    "https://user:pa/ss@example.com/path",
    "https://example.com/cb?id_token=value&client_secret=value",
    "person@example.com",
  ])("removes sensitive value from %s", (input) => {
    const output = redactSensitiveText(input);
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("person@example.com");
    expect(output).not.toContain("org_live_abcdefghijklmnopqrstuvwxyz");
  });
});
