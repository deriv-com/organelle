"use client";

import { useEffect } from "react";

import { PageError } from "@/components/page-state";
import { reportClientEvent } from "@/features/telemetry/client-reporter";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientEvent({
      type: "route_error",
      message: error.name,
      stack: error.stack,
    });
  }, [error]);

  return (
    <main className="h-full">
      <PageError title="Couldn’t load this page" onRetry={reset} />
    </main>
  );
}
