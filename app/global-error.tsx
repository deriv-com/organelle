"use client";

import { useEffect } from "react";

import { PageError } from "@/components/page-state";
import {
  isChunkLoadFailure,
  reportClientEvent,
  shouldHardReload,
} from "@/features/telemetry/client-reporter";

import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const chunk = isChunkLoadFailure(error.message, error.name);
    reportClientEvent({
      type: chunk ? "chunk_load_error" : "global_error",
      message: error.name,
      stack: error.stack,
    });
    if (!chunk || typeof window === "undefined") return;
    try {
      if (
        shouldHardReload(window.location.pathname, Date.now(), window.sessionStorage)
      ) {
        window.location.reload();
      }
    } catch {
      /* sessionStorage can throw; stay on the recovery screen */
    }
  }, [error]);

  return (
    <html lang="en" className="h-full">
      <body className="h-full overflow-hidden bg-background text-foreground antialiased">
        <main className="h-full">
          <PageError title="Couldn’t load this page" onRetry={reset} />
        </main>
      </body>
    </html>
  );
}
