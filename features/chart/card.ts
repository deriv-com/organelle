/**
 * Card rendering. Pure string builders — unit-tested,
 * no d3 import. Everything interpolated is HTML-escaped: these strings land in
 * foreignObject innerHTML and the data is user/directory-controlled.
 */

import { isSafeHttpUrl } from "@/lib/safe-url";

import type { ChartRow, SeatMember } from "./chart-row";
import { deptColor } from "./dept-color";

export { assignDeptColors, deptColor } from "./dept-color";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Mix a hex colour toward white (amount 0..1) — a SOLID light tint, so
 *  connector lines never show through a translucent header card. */
export function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-09-04" → "Joining 4 Sep".
 *  Defensive: the SQL casts joining_date to text, but a Date or garbage input
 *  must never crash a render. */
export function formatJoining(isoDate: string): string {
  if (typeof isoDate !== "string") return "Joining soon";
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return "Joining soon";
  return `Joining ${day} ${MONTHS[month - 1]}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function avatarHtml(member: SeatMember): string {
  if (member.avatarUrl && isSafeHttpUrl(member.avatarUrl)) {
    return `<img src="${escapeHtml(member.avatarUrl)}" alt="" draggable="false" class="size-9 shrink-0 rounded-full object-cover" loading="lazy" />`;
  }
  return `<div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-muted-foreground">${escapeHtml(initials(member.displayName))}</div>`;
}

/** Grip handle for one member. Rendered only in editable mode. */
function gripHtml(authId: string): string {
  return `<span data-member-drag="${escapeHtml(authId)}" title="Drag to move this person" class="-ml-1 shrink-0 cursor-move text-muted-foreground/40 hover:text-muted-foreground"><svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor"><circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/><circle cx="2" cy="6" r="1.2"/><circle cx="6" cy="6" r="1.2"/><circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/></svg></span>`;
}

function memberRow(member: SeatMember, editable: boolean, jobTitle?: string): string {
  const joining =
    member.status === "joining" && member.joiningDate
      ? `<div class="text-[11px] font-medium text-orange-500">${escapeHtml(formatJoining(member.joiningDate))}</div>`
      : "";
  const title =
    editable && jobTitle
      ? `<div class="truncate text-[11px] leading-tight text-muted-foreground">${escapeHtml(jobTitle)}</div>`
      : "";
  const noticeText = servingNoticeIsMuted(member) ? " opacity-55" : "";
  return `
    <div class="flex min-w-0 flex-1 items-center gap-2.5 p-2.5" data-member-id="${escapeHtml(member.authId)}">
      ${editable ? gripHtml(member.authId) : ""}
      ${avatarHtml(member)}
      <div class="min-w-0${noticeText}">
        <div class="truncate text-[13px] font-semibold leading-tight text-foreground">${escapeHtml(member.displayName)}</div>
        ${title}
        <div class="truncate text-[11px] leading-tight text-muted-foreground">${escapeHtml(member.officeLocation)}</div>
        ${joining}
      </div>
    </div>`;
}

function servingNoticeIsMuted(member: SeatMember): boolean {
  if (member.status !== "serving_notice") return false;
  if (member.positionLevel != null) return member.positionLevel < 5;
  return member.servingNoticeMuted ?? true;
}

export function memberAuthIdFromTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest("[data-member-id]")?.getAttribute("data-member-id") ?? null;
}

function seatCardFrame(
  inner: string,
  color: string,
  status: SeatMember["status"],
  servingNoticeMuted: boolean,
  isRoot: boolean,
): string {
  const joining = status === "joining";
  const noticeFrame = servingNoticeMuted ? ' style="background:#f3f4f6"' : "";
  return `<div data-status="${escapeHtml(status)}" class="relative flex h-full w-full overflow-hidden rounded-md border ${joining ? "border-dashed border-orange-300" : "border-border"} bg-card shadow-sm"${noticeFrame}>
        <div class="${isRoot ? "w-2" : "w-1"} shrink-0" style="background:${color}"></div>
        ${inner}
      </div>`;
}

const WARNING_BADGE = `<span class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-px text-[11px] font-medium text-amber-800"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>Vacant</span>`;

export type MergeTint = "added" | "removed" | "moved" | "edited";

function mergeTintShell(tint: MergeTint | undefined): string {
  if (!tint) return "";
  const ring = " ring-[3px] ring-offset-2 ring-offset-background";
  if (tint === "added") return `${ring} ring-green-500 bg-green-500/10`;
  if (tint === "removed") return `${ring} ring-red-500 bg-red-500/10`;
  return `${ring} ring-amber-400 bg-amber-400/15`;
}

function wrapMergeTint(inner: string, tint: MergeTint | undefined): string {
  const shell = mergeTintShell(tint);
  if (!shell) return inner;
  return `<div class="h-full w-full rounded-md${shell}">${inner}</div>`;
}

export interface CardContext {
  /** Colour-family header node_id; null for the root family. */
  dept: string | null;
  /** Resolved unique colours keyed by family header id. */
  colors?: Map<string, string>;
  isRoot: boolean;
  /** Sandbox mode: renders per-member grip handles for member drags. */
  editable?: boolean;
  mergeTint?: MergeTint;
  /** Persist in flight for this card. */
  saving?: boolean;
}

const SAVING_BANNER = `<div class="pointer-events-none absolute inset-x-0 bottom-0 flex h-5 items-center justify-center gap-1 rounded-b-md bg-foreground/80 text-[11px] font-medium text-background"><span class="size-3 animate-spin rounded-full border-2 border-background/30 border-t-background"></span>Saving</div>`;

function withSaving(inner: string, saving: boolean | undefined): string {
  if (!saving) return inner;
  return `<div class="relative h-full w-full" data-saving="true">${inner}${SAVING_BANNER}</div>`;
}

export function cardHtml(row: ChartRow, ctx: CardContext): string {
  const color = deptColor(ctx.dept, ctx.colors);
  const tintShell = mergeTintShell(ctx.mergeTint);

  if (row.kind === "header") {
    // Tinted header card: the department colour marks the section's owner
    // (v1 parity). Solid light tint — a translucent fill lets the connector
    // lines show through the card (2026-08-19 report). GridOrgChart reserves
    // the subtree's width as empty layout space around this standard-width card.
    return withSaving(
      wrapMergeTint(
        `
      <div class="flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-md shadow-sm" style="background:${tint(color, 0.76)};border:1px solid ${color}">
        <div class="px-2.5 text-center text-[13px] font-semibold leading-tight text-foreground">${escapeHtml(row.name ?? "")}</div>
      </div>`,
        ctx.mergeTint,
      ),
      ctx.saving,
    );
  }

  if (row.members.length === 0) {
    // Vacant seat. Sandbox shows the stored title so the new role is
    // recognizable; published/historical show a generic label only.
    const vacantLabel = ctx.editable ? (row.jobTitle ?? "Vacant seat") : "Vacant seat";
    return withSaving(
      wrapMergeTint(
        `
      <div class="flex h-full w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-muted shadow-sm">
        <div class="px-2.5 text-center text-xs font-medium text-muted-foreground">${escapeHtml(vacantLabel)}</div>
        ${WARNING_BADGE}
      </div>`,
        ctx.mergeTint,
      ),
      ctx.saving,
    );
  }

  const host = row.members[0]!;
  const editable = ctx.editable ?? false;

  // Peer seats stay one ChartRow. Visual is N stacked full cards
  // (amended 2026-08-24): same chrome as a single-member card, small gap.
  if (row.members.length === 1) {
    return withSaving(
      `
    <div class="relative h-full w-full${tintShell ? ` rounded-md${tintShell}` : ""}">
      ${seatCardFrame(memberRow(host, editable, row.jobTitle), color, host.status, servingNoticeIsMuted(host), ctx.isRoot)}
    </div>`,
      ctx.saving,
    );
  }

  const stack = row.members
    .map(
      (member) =>
        `<div class="min-h-0 flex-1">${seatCardFrame(memberRow(member, editable, row.jobTitle), color, member.status, servingNoticeIsMuted(member), ctx.isRoot)}</div>`,
    )
    .join("");

  return withSaving(
    `<div class="relative flex h-full w-full flex-col gap-1 rounded-md border border-border bg-background p-1 shadow-sm${tintShell}" data-peer-stack>${stack}</div>`,
    ctx.saving,
  );
}
