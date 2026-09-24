import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";

import { PageLoading } from "@/components/page-state";
import { previewSync } from "@/features/merge/actions";
import { MergeReview } from "@/features/merge/merge-review";

export const dynamic = "force-dynamic";

async function SyncContent({ params }: { params: Promise<{ treeId: string }> }) {
  const { treeId } = await params;
  const preview = await previewSync(treeId);
  if ("error" in preview) {
    if (preview.error === "Sandbox not found" || preview.error === "Malformed id") {
      notFound();
    }
    if (preview.error === "Sandbox is archived — restore it first") {
      redirect(`/sandbox/${treeId}`);
    }
    if (preview.error === "Sandbox is already up to date with live") {
      redirect(`/sandbox/${treeId}`);
    }
    if (preview.error === "Only the sandbox owner can do this") {
      redirect(`/sandbox/${treeId}`);
    }
    throw new Error("Couldn't load sync");
  }
  return (
    <main>
      <MergeReview initial={preview} mode="sync" />
    </main>
  );
}

export default function SyncPage({ params }: { params: Promise<{ treeId: string }> }) {
  return (
    <Suspense fallback={<PageLoading label="Loading sync…" />}>
      <SyncContent params={params} />
    </Suspense>
  );
}
