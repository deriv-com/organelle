import { describe, expect, it } from "vitest";

import { isSafeHttpUrl, mailtoHref } from "./safe-url";

describe("isSafeHttpUrl", () => {
  it("allows http and https", () => {
    expect(isSafeHttpUrl("https://cdn.example/a.png")).toBe(true);
    expect(isSafeHttpUrl("http://files.example/a.png")).toBe(true);
  });

  it("rejects javascript, data, and relative values", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeHttpUrl("/local.png")).toBe(false);
    expect(isSafeHttpUrl("")).toBe(false);
  });
});

describe("mailtoHref", () => {
  it("encodes the address", () => {
    expect(mailtoHref("ada@example.com")).toBe("mailto:ada%40example.com");
  });

  it("rejects query, fragment, and line breaks", () => {
    expect(mailtoHref("ada@example.com?cc=victim@example.com")).toBeNull();
    expect(mailtoHref("ada@example.com#frag")).toBeNull();
    expect(mailtoHref("ada@example.com\nbcc:victim@example.com")).toBeNull();
  });
});
