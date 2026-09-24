import { Suspense } from "react";

import { PageLoading } from "@/components/page-state";
import { SandboxAccessList } from "@/features/sandbox/sandbox-access-list";
import { listSandboxAccessOverview } from "@/features/sandbox/sharing";

export const dynamic = "force-dynamic";

async function SandboxAccessContent() {
  const rows = await listSandboxAccessOverview();
  return <SandboxAccessList rows={rows} />;
}

export default function SandboxAccessPage() {
  return (
    <main className="mx-auto h-full w-full max-w-7xl px-4 py-8">
      <Suspense fallback={<PageLoading label="Loading sandbox access…" />}>
        <SandboxAccessContent />
      </Suspense>
    </main>
  );
}
