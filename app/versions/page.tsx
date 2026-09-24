import { Suspense } from "react";

import { PageLoading } from "@/components/page-state";
import { listVersions } from "@/features/versions/actions";
import { VersionList } from "@/features/versions/version-list";

export const dynamic = "force-dynamic";

async function VersionsContent() {
  const versions = await listVersions();
  return <VersionList versions={versions} />;
}

export default function VersionsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <Suspense fallback={<PageLoading label="Loading versions…" />}>
        <VersionsContent />
      </Suspense>
    </main>
  );
}
