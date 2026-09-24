import { Suspense } from "react";
import { notFound } from "next/navigation";

import { PageLoading } from "@/components/page-state";
import { VersionChartRouteClient } from "@/features/versions/version-chart-route-client";

export const dynamic = "force-dynamic";

import { UUID_RE } from "@/lib/uuid";

export default async function VersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ treeId: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { treeId } = await params;
  const { focus } = await searchParams;
  if (!UUID_RE.test(treeId)) notFound();

  return (
    <main className="h-full overflow-hidden">
      <Suspense fallback={<PageLoading label="Loading version…" />}>
        <VersionChartRouteClient treeId={treeId} initialFocus={focus ?? null} />
      </Suspense>
    </main>
  );
}
