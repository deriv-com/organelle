import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("next.config redirects", () => {
  it("permanently sends /functional-org-chart to /chart", async () => {
    const redirects = nextConfig.redirects ? await nextConfig.redirects() : [];
    expect(redirects).toContainEqual({
      source: "/functional-org-chart",
      destination: "/chart",
      permanent: true,
    });
  });
});
