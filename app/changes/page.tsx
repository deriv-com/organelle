import { Suspense } from "react";

import { PageLoading } from "@/components/page-state";
import { ChangesClient } from "@/features/reports/changes/changes-client";

export const dynamic = "force-dynamic";

export default function ChangesPage() {
  return (
    <main className="mx-auto h-[calc(100vh-3.5rem)] w-full max-w-7xl">
      <Suspense fallback={<PageLoading label="Loading changes…" />}>
        <ChangesClient />
      </Suspense>
    </main>
  );
}
