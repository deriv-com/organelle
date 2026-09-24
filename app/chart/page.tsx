import { Suspense } from "react";

import { PageLoading } from "@/components/page-state";
import { ChartRouteClient } from "@/features/chart/chart-route-client";

export const dynamic = "force-dynamic";

export default async function ChartPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const { focus } = await searchParams;

  return (
    <main className="h-full overflow-hidden">
      <Suspense fallback={<PageLoading label="Loading chart…" />}>
        <ChartRouteClient initialFocus={focus ?? null} />
      </Suspense>
    </main>
  );
}
