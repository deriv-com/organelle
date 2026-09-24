import { Suspense } from "react";

import { PageLoading } from "@/components/page-state";
import { IntegrationsPage } from "@/features/integrations/integrations-page";

export const dynamic = "force-dynamic";

export default function IntegrationsRoutePage() {
  return (
    <main className="mx-auto flex h-full w-full max-w-7xl flex-col px-4 py-8">
      <Suspense fallback={<PageLoading label="Loading Integrations…" />}>
        <IntegrationsPage />
      </Suspense>
    </main>
  );
}
