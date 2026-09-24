/**
 * Shared CSV formatting for seat export and change report.
 */

const INJECTION_PREFIX = /^[=+\-@\t\r\n]/;

export function guardCsvCell(value: string): string {
  if (INJECTION_PREFIX.test(value)) return `'${value}`;
  return value;
}

export function formatCsvRow(cells: string[]): string {
  return cells.map((cell) => `"${guardCsvCell(cell).replace(/"/g, '""')}"`).join(",");
}

export function csvResponseBody(header: string, rows: string[][]): string {
  return [header, ...rows.map((row) => formatCsvRow(row))].join("\n");
}

export function csvContentDisposition(filename: string): string {
  return `attachment; filename="${filename.replace(/"/g, "")}"`;
}

export function organizationTimeZone(): string {
  const value = process.env.ORG_TIMEZONE?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    throw new Error(`Invalid ORG_TIMEZONE: ${value}`);
  }
}

/** Today as YYYY-MM-DD in the configured organization timezone. */
export function organizationDateString(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: organizationTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatOrganizationTimestamp(iso: string): string {
  return new Date(iso).toISOString();
}

function zonedMidnightUtc(dateYmd: string, timeZone: string): Date {
  const [year, month, day] = dateYmd.split("-").map(Number);
  if (!year || !month || !day) throw new Error("Invalid date; use YYYY-MM-DD");
  const desired = Date.UTC(year, month - 1, day);
  let guess = desired;
  for (let index = 0; index < 3; index++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value);
    const represented = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    guess += desired - represented;
  }
  return new Date(guess);
}

/** Calendar day [start, end) in the configured timezone as UTC bounds. */
export function organizationDayBounds(dateYmd: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd);
  if (!match) throw new Error("Invalid date; use YYYY-MM-DD");
  const [, y, m, d] = match;
  const timeZone = organizationTimeZone();
  const start = zonedMidnightUtc(dateYmd, timeZone);
  const next = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + 1));
  const nextYmd = next.toISOString().slice(0, 10);
  const end = zonedMidnightUtc(nextYmd, timeZone);
  return { start, end };
}
