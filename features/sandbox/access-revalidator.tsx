"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useOrgData } from "@/store/org-data";

export const SANDBOX_ACCESS_REVALIDATE_MS = 15_000;

export function SandboxAccessRevalidator({ treeId }: { treeId: string }) {
  const router = useRouter();

  useEffect(() => {
    let stopped = false;
    let checking = false;
    let controller: AbortController | null = null;

    async function revalidate() {
      if (stopped || checking) return;
      checking = true;
      controller = new AbortController();
      try {
        const response = await fetch(
          `/api/sandboxes/${encodeURIComponent(treeId)}/access`,
          {
            cache: "no-store",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        );
        if (stopped || (response.status !== 401 && response.status !== 403)) {
          return;
        }
        useOrgData.getState().clearTreeData(treeId);
        router.replace("/chart");
      } catch {
        // A transient network failure is not proof that access was revoked.
      } finally {
        checking = false;
        controller = null;
      }
    }

    const onFocus = () => void revalidate();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void revalidate();
    };

    void revalidate();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const interval = window.setInterval(
      () => void revalidate(),
      SANDBOX_ACCESS_REVALIDATE_MS,
    );

    return () => {
      stopped = true;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router, treeId]);

  return null;
}
