import { Suspense } from "react";

import { PageLoading } from "@/components/page-state";
import { AuditLog } from "@/features/audit/audit-log";
import { parseAuditFilters } from "@/features/audit/filters";

export const dynamic = "force-dynamic";

type AuditSearchParams = Promise<Record<string, string | string[] | undefined>>;

async function AuditContent({ searchParams }: { searchParams: AuditSearchParams }) {
  const filters = parseAuditFilters(await searchParams);
  return <AuditLog initialFilters={filters} />;
}

export default function AuditPage({
  searchParams,
}: {
  searchParams: AuditSearchParams;
}) {
  return (
    <main className="mx-auto h-[calc(100vh-3.5rem)] w-full max-w-7xl">
      <Suspense fallback={<PageLoading label="Loading audit log…" />}>
        <AuditContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
