/**
 * Split expand/collapse chips. Left = whole subtree, right = next
 * level. Chrome matches the library's original square button (9px type,
 * 3px radius) — two of those side by side, not one wide pill.
 */

export type ExpandMode = "all" | "level";
export type ChevronDir = "up" | "down";

export const CHIP_WIDTH = 64;
export const CHIP_HEIGHT = 16;

function chevronSvg(dir: ChevronDir, double: boolean): string {
  const d = dir === "down" ? "M2 4 L6 8 L10 4" : "M2 8 L6 4 L10 8";
  const one = `<path d="${d}" fill="none" stroke="#716E7B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (!double) {
    return `<svg width="7" height="7" viewBox="0 0 12 12" aria-hidden="true">${one}</svg>`;
  }
  const d2 = dir === "down" ? "M2 1 L6 5 L10 1" : "M2 11 L6 7 L10 11";
  const two = `<path d="${d2}" fill="none" stroke="#716E7B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg width="7" height="8" viewBox="0 0 12 12" aria-hidden="true">${one}${two}</svg>`;
}

function half(
  mode: ExpandMode,
  dir: ChevronDir,
  count: number,
  double: boolean,
): string {
  return `<div data-expand="${mode}" data-chevron="${dir}" style="pointer-events:auto;display:flex;align-items:center;justify-content:center;gap:1px;height:100%;padding:0 3px;cursor:pointer;font-size:9px;line-height:1;color:#716E7B;border:1px solid #E4E2E9;border-radius:3px;background:#fff;box-sizing:border-box">${chevronSvg(dir, double)}<span>${count}</span></div>`;
}

export function expandChipHtml(opts: {
  nextLevelOpen: boolean;
  fullyExpanded: boolean;
  total: number;
  direct: number;
}): string {
  const allDir: ChevronDir = opts.fullyExpanded ? "up" : "down";
  const levelDir: ChevronDir = opts.nextLevelOpen ? "up" : "down";
  return `<div style="display:flex;align-items:stretch;justify-content:center;gap:2px;width:100%;height:100%;box-sizing:border-box">${half("all", allDir, opts.total, true)}${half("level", levelDir, opts.direct, false)}</div>`;
}

export function expandModeFromEvent(
  event: { target: EventTarget | null },
  pointerX: number,
  buttonX: number,
  buttonWidth: number,
): ExpandMode {
  const el = event.target as Element | null;
  const attr = el?.closest?.("[data-expand]")?.getAttribute("data-expand");
  if (attr === "all" || attr === "level") return attr;
  return pointerX < buttonX + buttonWidth / 2 ? "all" : "level";
}
