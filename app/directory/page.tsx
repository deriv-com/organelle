import { Suspense } from "react";

import { PageLoading } from "@/components/page-state";
import { DirectoryRouteClient } from "@/features/directory/directory-route-client";

export const dynamic = "force-dynamic";

export default function DirectoryPage() {
  return (
    <main className="h-full overflow-hidden">
      <Suspense fallback={<PageLoading label="Loading directory…" />}>
        <DirectoryRouteClient />
      </Suspense>
    </main>
  );
}
