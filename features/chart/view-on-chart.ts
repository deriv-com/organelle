/**
 * View on chart: same search-focus pipeline as chart search.
 * Stays on the current tree when already on a chart surface.
 * focusRequest is one-shot: leaving a chart surface clears it so a later
 * /chart?focus= deep link is not overwritten by the previous target.
 */

import { useOrgData } from "@/store/org-data";

export function isChartSurface(pathname: string): boolean {
  if (pathname === "/chart") return true;
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "sandbox" && parts.length === 2) return true;
  if (parts[0] === "versions" && parts.length === 2) return true;
  return false;
}

export function shouldClearFocusOnNavigate(fromPath: string, toPath: string): boolean {
  return isChartSurface(fromPath) && !isChartSurface(toPath);
}

/** Editable sandbox chart only — not merge review or the sandboxes list. */
export function isSandboxChartSurface(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  return parts[0] === "sandbox" && parts.length === 2;
}

export function shouldCloseSandboxHistoryOnNavigate(
  fromPath: string,
  toPath: string,
): boolean {
  return isSandboxChartSurface(fromPath) && fromPath !== toPath;
}

/** Close the Changes sheet and undo Radix scroll-lock leaks when it unmounts mid-open. */
export function closeSandboxHistorySheet(): void {
  useOrgData.getState().setHistoryOpen(false);
  if (typeof document === "undefined") return;
  document.body.style.pointerEvents = "";
  document.body.style.overflow = "";
  document.body.removeAttribute("data-scroll-locked");
}

export function directoryChartHref(nodeId: string): string {
  return `/chart?focus=${encodeURIComponent(nodeId)}`;
}

/** Write focusRequest. Close the dialog only on a chart surface — closing it
 *  on the directory races GlobalDrawer replaceState against the /chart?focus=
 *  Link and can cancel navigation. */
export function viewSeatOnChart(nodeId: string, pathname?: string): void {
  useOrgData.getState().requestFocus(nodeId);
  if (!pathname || isChartSurface(pathname)) {
    useOrgData.getState().setDrawerAuthId(null);
  }
}
