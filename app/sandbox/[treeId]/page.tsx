import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";

import { PageLoading } from "@/components/page-state";
import {
  buildChart,
  hydratePublicChartRows,
  toPublicChartRows,
} from "@/features/chart/chart-row";
import { ChartClient } from "@/features/chart/chart-client";
import { fetchPickerEmployees } from "@/features/chart/employee-picker-query";
import { getUndoState } from "@/features/sandbox/actions";
import { fetchPublishedTree, fetchTree } from "@/features/chart/tree-query";
import { getActor } from "@/features/auth/session";
import { getSandboxAccess } from "@/features/sandbox/access";
import { SandboxAccessRevalidator } from "@/features/sandbox/access-revalidator";

export const dynamic = "force-dynamic";

async function SandboxContent({
  params,
  searchParams,
}: {
  params: Promise<{ treeId: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { treeId } = await params;
  const { focus } = await searchParams;
  const session = await getActor();
  if (!session.ok) redirect("/chart");
  const access = await getSandboxAccess(treeId, session.actor);
  if (!access) notFound();
  if (!access.canView) redirect("/chart");
  const payload = await fetchTree(treeId);
  if (!payload) notFound();
  const live = await fetchPublishedTree();
  const editable = access.canEdit;
  const fullRows = buildChart(payload.rows).rows;
  const rows = editable
    ? fullRows
    : hydratePublicChartRows(toPublicChartRows(fullRows));
  const undo = editable ? await getUndoState(treeId) : null;
  const pickerEmployees = editable ? await fetchPickerEmployees(treeId) : [];
  return (
    <>
      <SandboxAccessRevalidator treeId={payload.treeId} />
      <ChartClient
        treeId={payload.treeId}
        treeKind="sandbox"
        versionSeq={payload.forkedFromSeq}
        sandboxName={payload.name}
        ownerAuthId={payload.ownerAuthId}
        archived={payload.archived}
        rows={rows}
        pickerEmployees={pickerEmployees}
        editable={editable}
        canPublish={access.canPublish}
        canShare={access.canManageSharing}
        canReadHistory={access.canReadHistory}
        liveSeq={live.versionSeq}
        forkedFromSeq={payload.forkedFromSeq}
        initialFocus={focus ?? null}
        undoLog={undo?.undoLog}
        redoLog={undo?.redoLog}
        canUndo={undo?.canUndo}
        canRedo={undo?.canRedo}
      />
    </>
  );
}

export default function SandboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ treeId: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  return (
    <main className="h-full overflow-hidden">
      <Suspense fallback={<PageLoading label="Loading sandbox…" />}>
        <SandboxContent params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
