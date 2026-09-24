import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { nextLifecycleStatus } from "./status-lifecycle";

describe("nextLifecycleStatus", () => {
  it("flips joining to active when joining_date is today or past", () => {
    expect(
      nextLifecycleStatus({
        status: "joining",
        joiningDate: "2026-09-07",
        lastWorkingDate: null,
        today: "2026-09-07",
      }),
    ).toBe("active");
  });

  it("flips to resigned when last_working_date is past", () => {
    expect(
      nextLifecycleStatus({
        status: "serving_notice",
        joiningDate: "2020-01-01",
        lastWorkingDate: "2026-09-01",
        today: "2026-09-07",
      }),
    ).toBe("resigned");
  });

  it("flips any status to serving notice while last_working_date is not past", () => {
    expect(
      nextLifecycleStatus({
        status: "active",
        joiningDate: null,
        lastWorkingDate: "2026-09-07",
        today: "2026-09-07",
      }),
    ).toBe("serving_notice");
    expect(
      nextLifecycleStatus({
        status: "inactive",
        joiningDate: null,
        lastWorkingDate: "2026-10-01",
        today: "2026-09-07",
      }),
    ).toBe("serving_notice");
  });

  it("leaves future joiners unchanged", () => {
    expect(
      nextLifecycleStatus({
        status: "joining",
        joiningDate: "2026-12-01",
        lastWorkingDate: null,
        today: "2026-09-07",
      }),
    ).toBe("joining");
  });

  it("lifecycle SQL stamps status_updated_at when status flips", () => {
    const src = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "status-lifecycle.server.ts",
      ),
      "utf8",
    );
    expect(src).toContain("status_updated_at = now()");
    expect(src).toContain("when last_working_date is not null");
    expect(src).toContain("then 'serving_notice'");
  });
});
