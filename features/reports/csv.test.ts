import { afterEach, describe, expect, it } from "vitest";

import {
  guardCsvCell,
  organizationDayBounds,
  formatOrganizationTimestamp,
} from "./csv";

describe("guardCsvCell", () => {
  it("prefixes formula injection characters", () => {
    expect(guardCsvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(guardCsvCell("+123")).toBe("'+123");
    expect(guardCsvCell("@user")).toBe("'@user");
  });

  it("leaves safe values unchanged", () => {
    expect(guardCsvCell("hello")).toBe("hello");
  });
});

describe("organizationDayBounds", () => {
  const originalTimezone = process.env.ORG_TIMEZONE;

  afterEach(() => {
    if (originalTimezone === undefined) delete process.env.ORG_TIMEZONE;
    else process.env.ORG_TIMEZONE = originalTimezone;
  });

  it("defaults to UTC midnight boundaries", () => {
    delete process.env.ORG_TIMEZONE;
    const { start, end } = organizationDayBounds("2026-08-05");
    expect(start.toISOString()).toBe("2026-08-05T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-06T00:00:00.000Z");
  });

  it("uses Asia/Kuala_Lumpur midnight boundaries", () => {
    process.env.ORG_TIMEZONE = "Asia/Kuala_Lumpur";
    const { start, end } = organizationDayBounds("2026-08-05");
    expect(start.toISOString()).toBe("2026-08-04T16:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-05T16:00:00.000Z");
  });

  it("classifies 23:59 KL as inside the day", () => {
    process.env.ORG_TIMEZONE = "Asia/Kuala_Lumpur";
    const { start, end } = organizationDayBounds("2026-08-05");
    const late = new Date("2026-08-05T15:59:00.000Z");
    expect(late >= start && late < end).toBe(true);
  });

  it("classifies 00:00 KL next day as outside", () => {
    process.env.ORG_TIMEZONE = "Asia/Kuala_Lumpur";
    const { end } = organizationDayBounds("2026-08-05");
    const next = new Date("2026-08-05T16:00:00.000Z");
    expect(next >= end).toBe(true);
  });

  it("accounts for daylight-saving transitions", () => {
    process.env.ORG_TIMEZONE = "America/New_York";
    const { start, end } = organizationDayBounds("2026-03-08");
    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
});

describe("formatOrganizationTimestamp", () => {
  it("formats timestamps as ISO-8601", () => {
    expect(formatOrganizationTimestamp("2026-08-05T10:00:00.000Z")).toBe(
      "2026-08-05T10:00:00.000Z",
    );
  });
});
