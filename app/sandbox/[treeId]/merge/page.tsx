import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";

import { PageLoading } from "@/components/page-state";
import { previewMerge } from "@/features/merge/actions";
import { MergeReview } from "@/features/merge/merge-review";

export const dynamic = "force-dynamic";

async function MergeContent({ params }: { params: Promise<{ treeId: string }> }) {
  const { treeId } = await params;
  const preview = await previewMerge(treeId);
  if ("error" in preview) {
    if (preview.error === "Sandbox not found" || preview.error === "Malformed id") {
      notFound();
    }
    if (preview.error === "Sandbox is archived — restore it first") {
      redirect(`/sandbox/${treeId}`);
    }
    if (preview.error === "Not allowed") {
      redirect(`/sandbox/${treeId}`);
    }
    throw new Error("Couldn’t load merge");
  }
  return (
    <main>
      <MergeReview initial={preview} />
    </main>
  );
}

export default function MergePage({ params }: { params: Promise<{ treeId: string }> }) {
  return (
    <Suspense fallback={<PageLoading label="Loading merge…" />}>
      <MergeContent params={params} />
    </Suspense>
  );
}
