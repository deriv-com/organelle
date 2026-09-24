import { Suspense } from "react";

import { PageLoading } from "@/components/page-state";
import { SandboxList } from "@/features/sandbox/sandbox-list";

export const dynamic = "force-dynamic";

export default function SandboxesPage() {
  return (
    <main className="mx-auto min-h-full w-full max-w-5xl px-4 pb-12 pt-6">
      <Suspense fallback={<PageLoading label="Loading sandboxes…" />}>
        <SandboxList />
      </Suspense>
    </main>
  );
}
