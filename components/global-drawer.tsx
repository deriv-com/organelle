"use client";

/**
 * Global employee dialog, mounted once in the root layout. Opens from any
 * page via the org-data store; reads the tree payload from the same store
 * (hydrated by whichever page is active).
 *
 * Spec 05: dialog state is client-side. The ?employee= URL param is adopted
 * once on load (deep links) and mirrored with history.replaceState — never a
 * router navigation, so open/close costs no server round trip.
 */

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  closeSandboxHistorySheet,
  shouldClearFocusOnNavigate,
  shouldCloseSandboxHistoryOnNavigate,
} from "@/features/chart/view-on-chart";
import { EmployeeDialog } from "@/features/directory/employee-dialog";
import { useOrgData } from "@/store/org-data";

export function GlobalDrawer() {
  const chartRows = useOrgData((state) => state.chartRows);
  const directoryRows = useOrgData((state) => state.directoryRows);
  const authId = useOrgData((state) => state.drawerAuthId);
  const originNodeId = useOrgData((state) => state.drawerNodeId);
  const setDrawerAuthId = useOrgData((state) => state.setDrawerAuthId);
  const clearFocusRequest = useOrgData((state) => state.clearFocusRequest);
  const pathname = usePathname();

  // Deep link: adopt ?employee= once on mount.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const initial = new URLSearchParams(window.location.search).get("employee");
    if (initial) setDrawerAuthId(initial);
  }, [setDrawerAuthId]);

  // Close on page navigation (the dialog's data belongs to the old page).
  // Leaving a chart surface drops leftover focusRequest so /chart?focus= on
  // the next visit is not overwritten by the previous in-chart target.
  const prevPath = useRef(pathname);
  useEffect(() => {
    if (prevPath.current === pathname) return;
    if (shouldClearFocusOnNavigate(prevPath.current, pathname)) {
      clearFocusRequest();
    }
    if (shouldCloseSandboxHistoryOnNavigate(prevPath.current, pathname)) {
      closeSandboxHistorySheet();
    }
    prevPath.current = pathname;
    setDrawerAuthId(null);
  }, [pathname, setDrawerAuthId, clearFocusRequest]);

  // Mirror the URL for shareable deep links without an RSC navigation.
  useEffect(() => {
    if (window.location.pathname !== pathname) return;
    const params = new URLSearchParams(window.location.search);
    if (authId) params.set("employee", authId);
    else params.delete("employee");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }, [authId, pathname]);

  return (
    <EmployeeDialog
      chartRows={chartRows}
      directoryRows={directoryRows}
      authId={authId}
      originNodeId={originNodeId}
      onClose={() => setDrawerAuthId(null)}
    />
  );
}
