import { Suspense } from "react";

import { PageLoading } from "@/components/page-state";
import { RolesAdmin } from "@/features/auth/roles-admin";

export const dynamic = "force-dynamic";

export default function RolesPage() {
  return (
    <main className="mx-auto h-full w-full max-w-3xl px-4 py-8">
      <Suspense fallback={<PageLoading label="Loading users…" />}>
        <RolesAdmin />
      </Suspense>
    </main>
  );
}
