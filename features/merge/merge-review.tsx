"use client";

/**
 * Merge review: split charts; details and submit in Dialogs.
 */

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, CheckCircle2, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { PageLoading } from "@/components/page-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartControls } from "@/features/chart/chart-controls";
import type { MergeTint } from "@/features/chart/card";
import { buildChart } from "@/features/chart/chart-row";
import type { ExpandChipSnapshot } from "@/features/chart/collapse";
import type { ExpandMode } from "@/features/chart/expand-chip";
import type { ChartCamera } from "@/features/chart/org-chart";
import { cn } from "@/lib/utils";
import { useOrgData } from "@/store/org-data";
import { setCachedSandboxArchived } from "@/features/sandbox/sandbox-client-cache";
import {
  canOverrideChangeReason,
  changeTypeLabel,
  MANUAL_CHANGE_REASON_VALUES,
  type ManualChangeReason,
} from "@/features/reports/changes/labels";
import { buildProspectiveChangeReasons } from "@/features/reports/changes/prospective";
import { commitMerge, commitSync, reForkSandbox, type PreviewPayload } from "./actions";
import { runMerge } from "./engine";
import {
  buildMergeChangeNavItems,
  changeNavKindDot,
  changeNavKindLabel,
  includeKeyForNavItem,
  MergeChangeNav,
  type MergeChangeNavItem,
} from "./merge-change-nav";
import { indexRows, nodeLabel, overridesFromRows, toQueryRows } from "./tree";
import { formatConflictSide } from "./types";
import type { MergeTarget, Resolution } from "./types";
import { bulkResolutionFor } from "./bulk-resolution";

const OrgChartView = dynamic(() => import("@/features/chart/org-chart"), {
  ssr: false,
  loading: () => <PageLoading label="Loading chart…" />,
});

const MERGE_CACHE_PREFIX = "organelle.merge.resolutions.";
const SYNC_CACHE_PREFIX = "organelle.sync.resolutions.";

function loadCache(
  sandboxId: string,
  mode: "publish" | "sync",
): Record<string, Resolution> {
  try {
    const prefix = mode === "sync" ? SYNC_CACHE_PREFIX : MERGE_CACHE_PREFIX;
    const raw = sessionStorage.getItem(prefix + sandboxId);
    return raw ? (JSON.parse(raw) as Record<string, Resolution>) : {};
  } catch {
    return {};
  }
}

function saveCache(
  sandboxId: string,
  value: Record<string, Resolution>,
  mode: "publish" | "sync",
): void {
  const prefix = mode === "sync" ? SYNC_CACHE_PREFIX : MERGE_CACHE_PREFIX;
  sessionStorage.setItem(prefix + sandboxId, JSON.stringify(value));
}

function displayReviewValue(value: string | null, field: string): string {
  if (value == null || value === "") return "Blank";
  if (field !== "status") return value;
  return value
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function reviewTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EmployeeMergeChangeRow({
  item,
  onFocus,
}: {
  item: MergeChangeNavItem;
  onFocus: (nodeId: string) => void;
}) {
  if (!item.fieldChanges || item.fieldChanges.length === 0) return null;
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
          <span className="size-2 shrink-0 rounded-full bg-amber-400" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {item.employee?.name ?? item.label.replace(/^Update /, "")}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {item.fieldChanges.length}{" "}
            {item.fieldChanges.length === 1 ? "field" : "fields"}
          </span>
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Updated
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-black/[0.06] bg-muted/20 px-3 py-2.5">
          <div className="grid grid-cols-[minmax(6.5rem,0.6fr)_minmax(0,1.4fr)] gap-x-3 gap-y-1.5 text-xs">
            {item.fieldChanges.map((field) => (
              <div
                key={field.field}
                className="col-span-2 grid grid-cols-subgrid items-start"
              >
                <span className="font-medium text-muted-foreground">{field.label}</span>
                <span className="min-w-0 break-words text-foreground">
                  {displayReviewValue(field.before, field.field)}
                  <span aria-hidden="true" className="mx-1.5 text-muted-foreground">
                    →
                  </span>
                  {displayReviewValue(field.after, field.field)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-black/[0.06] pt-2">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {item.employee?.actorName
                ? `by ${item.employee.actorName}`
                : "Included automatically"}
              {item.employee?.updatedAt
                ? ` • ${reviewTime(item.employee.updatedAt)}`
                : ""}
            </span>
            <button
              type="button"
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => onFocus(item.nodeId)}
            >
              View on charts
            </button>
          </div>
        </div>
      </details>
    </li>
  );
}

export function MergeReview({
  initial,
  mode = "publish",
}: {
  initial: PreviewPayload;
  mode?: "publish" | "sync";
}) {
  const router = useRouter();
  const setData = useOrgData((state) => state.setData);
  const setMergeChrome = useOrgData((state) => state.setMergeChrome);
  const mergeDialog = useOrgData((state) => state.mergeDialog);
  const setMergeDialog = useOrgData((state) => state.setMergeDialog);
  const [preview, setPreview] = useState(initial);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [cacheReady, setCacheReady] = useState(false);
  const [included, setIncluded] = useState<Set<string> | null>(null);
  const [title, setTitle] = useState("");
  const [changeReasonOverrides, setChangeReasonOverrides] = useState<
    Record<string, ManualChangeReason>
  >({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [transform, setTransform] = useState<{
    x: number;
    y: number;
    k: number;
  } | null>(null);
  const [expandSync, setExpandSync] = useState<{
    nodeId: string;
    mode: ExpandMode;
    levelOpen: boolean;
    fullyExpanded: boolean;
    gen: number;
    sourceTreeId: string;
  } | null>(null);
  const [focus, setFocus] = useState<{ nodeId: string; gen: number } | null>(null);
  const focusGenRef = useRef(0);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [reforkOpen, setReforkOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"conflicts" | "changes">("conflicts");
  const liveCameraRef = useRef<ChartCamera | null>(null);

  const isDetailsOpen =
    mergeDialog === "conflicts" ||
    mergeDialog === "changes" ||
    mergeDialog === "details";

  useEffect(() => {
    setData({
      treeId: preview.sandboxTreeId,
      treeKind: "sandbox",
      versionSeq: preview.forkedFromSeq,
      sandboxName: preview.sandboxName,
      publishedAt: null,
      chartRows: [],
      directoryRows: [],
    });
  }, [preview, setData]);

  const isSync = mode === "sync";
  const cachePrefix = isSync ? SYNC_CACHE_PREFIX : MERGE_CACHE_PREFIX;

  useEffect(() => {
    setResolutions(loadCache(preview.sandboxTreeId, mode));
    setCacheReady(true);
  }, [preview.sandboxTreeId, mode]);

  useEffect(() => {
    if (!cacheReady) return;
    saveCache(preview.sandboxTreeId, resolutions, mode);
  }, [preview.sandboxTreeId, resolutions, cacheReady, mode]);

  const includedKeys = useMemo(
    () => (included === null ? null : [...included]),
    [included],
  );

  const mergeArgs = useMemo(
    () => ({
      base: indexRows(preview.baseRows),
      live: indexRows(preview.liveRows),
      sandbox: indexRows(preview.sandboxRows),
      liveSeq: preview.liveSeq,
      forkedFromSeq: preview.forkedFromSeq,
      target: (isSync ? "sandbox" : "published") as MergeTarget,
      resolutions,
      baseOverrides: overridesFromRows(preview.baseRows),
      liveOverrides: overridesFromRows(preview.liveRows),
      sandboxOverrides: overridesFromRows(preview.sandboxRows),
      liveEmployeeDetails: preview.liveEmployeeDetails,
    }),
    [preview, resolutions, isSync],
  );

  const catalog = useMemo(
    () =>
      runMerge({
        ...mergeArgs,
        includedKeys: null,
      }),
    [mergeArgs],
  );

  const computed = useMemo(
    () =>
      runMerge({
        ...mergeArgs,
        includedKeys: isSync ? null : includedKeys,
      }),
    [mergeArgs, includedKeys, isSync],
  );

  const prospectiveReasons = useMemo(() => {
    if (isSync || !computed.valid) return [];
    try {
      return buildProspectiveChangeReasons(
        preview.liveRows,
        toQueryRows(computed.merged),
      );
    } catch {
      return [];
    }
  }, [computed.merged, computed.valid, isSync, preview.liveRows]);

  useEffect(() => {
    const eligible = new Set(
      prospectiveReasons
        .filter((reason) => canOverrideChangeReason(reason.automaticType))
        .map((reason) => reason.nodeId),
    );
    setChangeReasonOverrides((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([nodeId]) => eligible.has(nodeId)),
      ) as Record<string, ManualChangeReason>;
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [prospectiveReasons]);

  const nodeById = useMemo(() => {
    const map = new Map(indexRows(preview.liveRows).map((node) => [node.id, node]));
    for (const node of catalog.merged) map.set(node.id, node);
    for (const node of computed.merged) map.set(node.id, node);
    return map;
  }, [preview.liveRows, catalog.merged, computed.merged]);

  const changeNavItems = useMemo(
    () =>
      buildMergeChangeNavItems(
        catalog.tints,
        (nodeId) => nodeLabel(nodeById.get(nodeId)),
        catalog.changes,
      ),
    [catalog.tints, catalog.changes, nodeById],
  );

  const selectableChangeKeys = useMemo(
    () =>
      changeNavItems
        .map((item) => includeKeyForNavItem(item, catalog.changes))
        .filter((key): key is string => key !== null),
    [changeNavItems, catalog.changes],
  );

  const employeeChangeItems = useMemo(
    () => changeNavItems.filter((item) => item.changeKey?.startsWith("employee:")),
    [changeNavItems],
  );
  const structureChangeItems = useMemo(
    () => changeNavItems.filter((item) => !item.changeKey?.startsWith("employee:")),
    [changeNavItems],
  );

  const unresolvedNodeIds = useMemo(
    () => new Set(computed.unresolved.map((c) => c.nodeId)),
    [computed.unresolved],
  );

  useEffect(() => {
    setMergeChrome({
      conflictCount: computed.unresolved.length + computed.graphConflicts.length,
      changeCount: changeNavItems.length,
    });
  }, [
    computed.unresolved.length,
    computed.graphConflicts.length,
    changeNavItems.length,
    setMergeChrome,
  ]);

  useEffect(() => {
    return () => {
      setMergeChrome(null);
      setMergeDialog(null);
    };
  }, [setMergeChrome, setMergeDialog]);

  const liveChart = useMemo(() => {
    try {
      return buildChart(preview.liveRows);
    } catch {
      return null;
    }
  }, [preview.liveRows]);

  const previewChart = useMemo(() => {
    try {
      return buildChart(toQueryRows(computed.merged));
    } catch {
      return null;
    }
  }, [computed.merged]);

  const liveTints = useMemo(() => {
    const map: Partial<Record<string, MergeTint>> = {};
    if (isSync) {
      for (const change of computed.changes) {
        map[change.nodeId] =
          change.kind === "create"
            ? "added"
            : change.kind === "delete"
              ? "removed"
              : change.kind === "move"
                ? "moved"
                : "edited";
      }
      return map;
    }
    for (const id of computed.tints.removed) map[id] = "removed";
    for (const id of computed.tints.moved) map[id] = "moved";
    for (const id of computed.tints.edited) map[id] = "edited";
    return map;
  }, [computed.tints, computed.changes, isSync]);

  const previewTints = useMemo(() => {
    const map: Partial<Record<string, MergeTint>> = {};
    for (const id of computed.tints.added) map[id] = "added";
    for (const id of computed.tints.moved) map[id] = "moved";
    for (const id of computed.tints.edited) map[id] = "edited";
    return map;
  }, [computed.tints]);

  const blocking = [...computed.unresolved, ...computed.graphConflicts];
  // Resolutions only alter the preview; they are not written until Proceed.
  // Keep every original conflict visible so a user can inspect or change a
  // selection instead of making it disappear like an already-applied action.
  const allConflicts = [...computed.conflicts, ...computed.graphConflicts];

  useEffect(() => {
    if (mergeDialog === "conflicts") setActiveTab("conflicts");
    else if (mergeDialog === "changes") setActiveTab("changes");
    else if (mergeDialog === "details") {
      setActiveTab(allConflicts.length > 0 ? "conflicts" : "changes");
    }
  }, [mergeDialog, allConflicts.length]);

  const setChoice = (key: string, resolution: Resolution) => {
    setResolutions((prev) => ({ ...prev, [key]: resolution }));
  };

  const bulk = (side: "live" | "sandbox") => {
    setResolutions((prev) => {
      const next = { ...prev };
      for (const conflict of allConflicts) {
        const resolution = bulkResolutionFor(conflict, side);
        if (resolution) next[conflict.key] = resolution;
      }
      return next;
    });
  };

  const syncTransform = useCallback((t: { x: number; y: number; k: number }) => {
    setTransform(t);
  }, []);

  const handleUserExpand = useCallback(
    (
      sourceTreeId: string,
      nodeId: string,
      mode: ExpandMode,
      snapshot: ExpandChipSnapshot,
    ) => {
      setExpandSync((prev) => ({
        nodeId,
        mode,
        levelOpen: snapshot.levelOpen,
        fullyExpanded: snapshot.fullyExpanded,
        sourceTreeId,
        gen: (prev?.gen ?? 0) + 1,
      }));
    },
    [],
  );

  const focusNode = useCallback((nodeId: string) => {
    focusGenRef.current += 1;
    setFocus({ nodeId, gen: focusGenRef.current });
  }, []);

  const commit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (isSync) {
        const result = await commitSync({
          sandboxTreeId: preview.sandboxTreeId,
          resolutions,
          cachedAtSeq: preview.liveSeq,
        });
        if (result.ok) {
          sessionStorage.removeItem(cachePrefix + preview.sandboxTreeId);
          toast.success("Sandbox synced with live");
          router.push(`/sandbox/${preview.sandboxTreeId}`);
          return;
        }
        if (result.code === "error") {
          setMessage(result.reason);
          return;
        }
        setMessage(result.message);
        setPreview(result.preview);
        setMergeDialog(null);
        return;
      }
      const result = await commitMerge({
        sandboxTreeId: preview.sandboxTreeId,
        title,
        resolutions,
        includedKeys,
        changeReasonOverrides,
        cachedAtSeq: preview.liveSeq,
      });
      if (result.ok) {
        sessionStorage.removeItem(cachePrefix + preview.sandboxTreeId);
        setCachedSandboxArchived(preview.sandboxTreeId, true);
        toast.success("Merge published — sandbox archived");
        router.push("/chart");
        return;
      }
      if (result.code === "error") {
        setMessage(result.reason);
        return;
      }
      setMessage(result.message);
      setPreview(result.preview);
      setMergeDialog(null);
    } finally {
      setBusy(false);
    }
  };

  const refork = async () => {
    setBusy(true);
    try {
      const result = await reForkSandbox(preview.sandboxTreeId);
      if (!result.ok) {
        setMessage(result.reason);
        return;
      }
      sessionStorage.removeItem(cachePrefix + preview.sandboxTreeId);
      router.push(`/sandbox/${result.treeId}`);
    } finally {
      setBusy(false);
      setReforkOpen(false);
    }
  };

  const toggleIncluded = (key: string) => {
    setIncluded((prev) => {
      const next = new Set(prev ?? selectableChangeKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {allConflicts.length > 25 ? (
        <Alert className="rounded-none border-x-0 border-t-0">
          <AlertTitle>This sandbox has drifted a long way from live</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <p>
              Re-forking may be faster than resolving {allConflicts.length} conflicts.
            </p>
            <Button size="sm" onClick={() => setReforkOpen(true)} disabled={busy}>
              Re-fork
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {message ? (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <AlertTitle>Couldn’t complete that</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div className="grid h-full min-h-0 grid-cols-2 gap-px bg-border">
          <div className="relative min-h-0 bg-background">
            <p className="absolute left-3 top-2 z-10 text-xs font-medium text-muted-foreground">
              Published
            </p>
            {liveChart && (
              <OrgChartView
                treeId="merge-live"
                rows={liveChart.rows}
                editable={false}
                tints={liveTints}
                focusId={focus?.nodeId}
                focusGen={focus?.gen}
                onUserTransform={syncTransform}
                externalTransform={transform}
                expandSync={expandSync}
                onUserExpand={(nodeId, mode, snapshot) =>
                  handleUserExpand("merge-live", nodeId, mode, snapshot)
                }
                cameraRef={liveCameraRef}
              />
            )}
          </div>
          <div className="relative min-h-0 bg-background">
            <p className="absolute left-3 top-2 z-10 text-xs font-medium text-muted-foreground">
              {isSync ? "After sync" : "Sandbox"}
            </p>
            {previewChart ? (
              <OrgChartView
                treeId="merge-preview"
                rows={previewChart.rows}
                editable={false}
                tints={previewTints}
                focusId={focus?.nodeId}
                focusGen={focus?.gen}
                onUserTransform={syncTransform}
                externalTransform={transform}
                expandSync={expandSync}
                onUserExpand={(nodeId, mode, snapshot) =>
                  handleUserExpand("merge-preview", nodeId, mode, snapshot)
                }
              />
            ) : (
              <p className="p-8 text-sm text-muted-foreground">
                Preview is blocked until the graph is valid.
              </p>
            )}
          </div>
        </div>

        <div className="pointer-events-none absolute top-10 left-1/2 z-20 -translate-x-1/2">
          <MergeChangeNav items={changeNavItems} onSelect={focusNode} />
        </div>

        <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
          <div className="pointer-events-auto">
            <ChartControls
              onZoomIn={() => liveCameraRef.current?.zoomBy(1.25)}
              onZoomOut={() => liveCameraRef.current?.zoomBy(0.8)}
              onFit={() => liveCameraRef.current?.fitVisible()}
            />
          </div>
        </div>
      </div>

      <Dialog
        open={isDetailsOpen}
        onOpenChange={(open) => !open && setMergeDialog(null)}
      >
        <DialogContent className="min-w-0 gap-5 overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-foreground">
              {isSync ? "Sync review" : "Merge review"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Forked from live v{preview.forkedFromSeq} → current live v
              {preview.liveSeq}
              {preview.zeroDrift ? " · no drift" : ""}
            </DialogDescription>
          </DialogHeader>

          <Tabs
            className="min-w-0 w-full max-w-full"
            value={activeTab}
            onValueChange={(val) => {
              const tab = val as "conflicts" | "changes";
              setActiveTab(tab);
              setMergeDialog(tab);
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="conflicts" className="gap-2">
                Conflicts
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                    allConflicts.length > 0
                      ? "bg-amber-500/15 font-semibold text-amber-700"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {allConflicts.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="changes" className="gap-2">
                Changes
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {changeNavItems.length}
                </span>
              </TabsTrigger>
            </TabsList>

            <div className="min-w-0 max-h-[55vh] w-full max-w-full overflow-x-hidden overflow-y-auto pt-2">
              <TabsContent value="conflicts" className="m-0 pr-3">
                <div className="flex flex-col gap-4">
                  {allConflicts.length > 0 ? (
                    <div className="flex items-center justify-between gap-2 px-0.5">
                      <span className="text-xs font-medium text-muted-foreground">
                        {blocking.length > 0
                          ? `${blocking.length} ${blocking.length === 1 ? "conflict" : "conflicts"} to resolve`
                          : "All conflicts resolved — review or proceed to apply"}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => bulk("live")}
                          disabled={
                            !allConflicts.some((conflict) =>
                              bulkResolutionFor(conflict, "live"),
                            )
                          }
                        >
                          All live chart
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => bulk("sandbox")}
                          disabled={
                            !allConflicts.some((conflict) =>
                              bulkResolutionFor(conflict, "sandbox"),
                            )
                          }
                        >
                          All sandbox
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {allConflicts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-background/50 p-8 text-center">
                      <CheckCircle2 className="size-8 text-primary" />
                      <p className="mt-2 text-sm font-semibold text-foreground">
                        No conflicts detected
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        This sandbox has zero conflicts and will merge cleanly into
                        live.
                      </p>
                    </div>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {allConflicts.map((conflict) => (
                        <li
                          key={conflict.key}
                          className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background p-4 shadow-2xs"
                        >
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {conflict.label}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {conflict.sentence}
                            </p>
                          </div>
                          {(() => {
                            const current = resolutions[conflict.key];
                            const live = bulkResolutionFor(conflict, "live");
                            const sandbox = bulkResolutionFor(conflict, "sandbox");
                            const sandboxNeedsParent =
                              !sandbox && conflict.allowed.includes("pick_new_target");
                            const isSelected = (resolution: Resolution | null) =>
                              resolution != null &&
                              current?.choice === resolution.choice;
                            return (
                              <div className="grid grid-cols-2 gap-2 text-left text-xs">
                                <button
                                  type="button"
                                  disabled={!live}
                                  aria-pressed={isSelected(live)}
                                  onClick={() => live && setChoice(conflict.key, live)}
                                  className={cn(
                                    "relative flex h-full flex-col items-start justify-start rounded-md border px-2.5 py-2 text-left transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                                    live
                                      ? "cursor-pointer hover:border-primary/60 hover:bg-primary/[0.03]"
                                      : "cursor-not-allowed opacity-50",
                                    isSelected(live)
                                      ? "border-primary bg-primary/10 shadow-sm"
                                      : "border-border/70 bg-muted/30",
                                  )}
                                >
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Live chart
                                  </p>
                                  <p className="mt-1 font-medium leading-snug text-foreground">
                                    {formatConflictSide(conflict.live)}
                                  </p>
                                  {isSelected(live) ? (
                                    <Check
                                      className="absolute right-2.5 top-2.5 size-3 text-primary"
                                      aria-label="Selected"
                                    />
                                  ) : null}
                                </button>
                                <button
                                  type="button"
                                  disabled={!sandbox && !sandboxNeedsParent}
                                  aria-pressed={
                                    isSelected(sandbox) ||
                                    current?.choice === "pick_new_target"
                                  }
                                  onClick={() => {
                                    if (sandbox) setChoice(conflict.key, sandbox);
                                    else if (sandboxNeedsParent)
                                      setPickFor(conflict.key);
                                  }}
                                  className={cn(
                                    "relative flex h-full flex-col items-start justify-start rounded-md border px-2.5 py-2 text-left transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                                    sandbox || sandboxNeedsParent
                                      ? "cursor-pointer hover:border-primary/60 hover:bg-primary/[0.03]"
                                      : "cursor-not-allowed opacity-50",
                                    isSelected(sandbox) ||
                                      current?.choice === "pick_new_target"
                                      ? "border-primary bg-primary/10 shadow-sm"
                                      : "border-border/70 bg-muted/30",
                                  )}
                                >
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Sandbox
                                  </p>
                                  <p className="mt-1 font-medium leading-snug text-foreground">
                                    {formatConflictSide(conflict.sandbox)}
                                  </p>
                                  {isSelected(sandbox) ||
                                  current?.choice === "pick_new_target" ? (
                                    <Check
                                      className="absolute right-2.5 top-2.5 size-3 text-primary"
                                      aria-label="Selected"
                                    />
                                  ) : null}
                                </button>
                              </div>
                            );
                          })()}
                          <div className="flex flex-wrap items-center gap-2">
                            {(() => {
                              const r = resolutions[conflict.key];
                              if (r?.choice !== "pick_new_target") return null;
                              const dest = computed.merged.find(
                                (n) => n.id === r.newParentId,
                              );
                              return dest ? (
                                <span className="text-xs font-medium text-primary">
                                  → {nodeLabel(dest)}
                                </span>
                              ) : null;
                            })()}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="changes" className="m-0 min-w-0 pr-3">
                <div className="flex flex-col gap-3">
                  {changeNavItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-background/50 p-8 text-center">
                      <p className="text-sm font-semibold text-foreground">
                        No changes
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {!isSync && (preview.stagedEmployeeCount ?? 0) > 0
                          ? `${preview.stagedEmployeeCount} staged employee records will be published with this merge.`
                          : "Published and sandbox match — nothing to review."}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-5">
                      {structureChangeItems.length > 0 ? (
                        <section className="flex flex-col gap-2">
                          <div className="flex items-end justify-between gap-3 px-0.5">
                            <div>
                              <p className="text-xs font-semibold text-foreground">
                                Structure changes
                              </p>
                              {selectableChangeKeys.length > 0 && !isSync ? (
                                <p className="mt-0.5 text-[11px] text-muted-foreground">
                                  {included === null
                                    ? selectableChangeKeys.length
                                    : selectableChangeKeys.filter((key) =>
                                        included.has(key),
                                      ).length}{" "}
                                  of {selectableChangeKeys.length} optional{" "}
                                  {selectableChangeKeys.length === 1
                                    ? "change"
                                    : "changes"}{" "}
                                  included
                                </p>
                              ) : null}
                            </div>
                            {selectableChangeKeys.length > 0 && !isSync ? (
                              <div className="flex items-center gap-1.5">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() =>
                                    setIncluded(new Set(selectableChangeKeys))
                                  }
                                >
                                  Select all
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => setIncluded(new Set())}
                                >
                                  Deselect all
                                </Button>
                              </div>
                            ) : null}
                          </div>
                          <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-xl border border-border/70">
                            {structureChangeItems.map((item) => {
                              const includeKey = includeKeyForNavItem(
                                item,
                                catalog.changes,
                              );
                              const hasConflict = unresolvedNodeIds.has(item.nodeId);
                              if (includeKey && !isSync) {
                                const isChecked =
                                  included === null || included.has(includeKey);
                                return (
                                  <li
                                    key={item.id}
                                    className={cn(
                                      "flex cursor-pointer select-none items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40",
                                      !isChecked && "opacity-60",
                                    )}
                                    onClick={() => toggleIncluded(includeKey)}
                                  >
                                    <Checkbox
                                      checked={isChecked}
                                      onCheckedChange={() => toggleIncluded(includeKey)}
                                      onClick={(event) => event.stopPropagation()}
                                    />
                                    <span
                                      className={cn(
                                        "size-2 shrink-0 rounded-full",
                                        changeNavKindDot(item.kind),
                                      )}
                                    />
                                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                                      {item.label}
                                    </span>
                                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                      {changeNavKindLabel(item.kind)}
                                    </span>
                                  </li>
                                );
                              }
                              return (
                                <li
                                  key={item.id}
                                  className="flex items-center gap-3 px-3 py-2.5"
                                >
                                  <span
                                    className={cn(
                                      "size-2 shrink-0 rounded-full",
                                      changeNavKindDot(item.kind),
                                    )}
                                  />
                                  <button
                                    type="button"
                                    className="min-w-0 flex-1 truncate text-left text-xs font-medium text-foreground hover:underline"
                                    onClick={() => focusNode(item.nodeId)}
                                  >
                                    {item.label}
                                  </button>
                                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    {changeNavKindLabel(item.kind)}
                                  </span>
                                  {hasConflict ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 shrink-0 text-xs"
                                      onClick={() => {
                                        setActiveTab("conflicts");
                                        setMergeDialog("conflicts");
                                      }}
                                    >
                                      Resolve
                                    </Button>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      ) : null}

                      {employeeChangeItems.length > 0 ? (
                        <section className="flex flex-col gap-2">
                          <div className="px-0.5">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-semibold text-foreground">
                                Employee updates
                              </p>
                              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                Always included
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              Employee details saved in this sandbox are published with
                              the merge.
                            </p>
                          </div>
                          <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-xl border border-border/70">
                            {employeeChangeItems.map((item) => (
                              <EmployeeMergeChangeRow
                                key={item.id}
                                item={item}
                                onFocus={focusNode}
                              />
                            ))}
                          </ul>
                        </section>
                      ) : null}
                    </div>
                  )}

                  {!isSync && prospectiveReasons.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <div className="px-0.5">
                        <p className="text-xs font-semibold text-foreground">
                          Change reasons
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Review the reason for each change and update it if needed.
                        </p>
                      </div>
                      <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-xl border border-border/70">
                        {prospectiveReasons.map((reason) => {
                          const canOverride = canOverrideChangeReason(
                            reason.automaticType,
                          );
                          const value =
                            changeReasonOverrides[reason.nodeId] ?? "automatic";
                          return (
                            <li
                              key={reason.nodeId}
                              className="flex flex-col items-stretch gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium text-foreground">
                                  {reason.employeeName}
                                </p>
                                <p className="truncate text-[11px] text-muted-foreground">
                                  {reason.position}
                                </p>
                              </div>
                              {canOverride ? (
                                <Select
                                  value={value}
                                  onValueChange={(selected) => {
                                    setChangeReasonOverrides((current) => {
                                      const next = { ...current };
                                      if (selected === "automatic")
                                        delete next[reason.nodeId];
                                      else
                                        next[reason.nodeId] =
                                          selected as ManualChangeReason;
                                      return next;
                                    });
                                  }}
                                >
                                  <SelectTrigger
                                    size="sm"
                                    className="w-full text-xs sm:w-56"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent align="end">
                                    <SelectItem value="automatic" className="text-xs">
                                      {changeTypeLabel(reason.automaticType)}
                                    </SelectItem>
                                    <SelectSeparator />
                                    {MANUAL_CHANGE_REASON_VALUES.map((manualReason) => (
                                      <SelectItem
                                        key={manualReason}
                                        value={manualReason}
                                        className="text-xs"
                                      >
                                        {changeTypeLabel(manualReason)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                                  {changeTypeLabel(reason.automaticType)}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </TabsContent>
            </div>
          </Tabs>

          <DialogFooter className="flex items-center justify-between pt-1 sm:justify-between">
            <Button variant="outline" onClick={() => setMergeDialog(null)}>
              Close
            </Button>
            <Button
              onClick={() => setMergeDialog("submit")}
              disabled={blocking.length > 0}
              className="gap-1.5"
            >
              {isSync ? "Proceed to apply" : "Proceed to submit"}
              <ArrowRight className="size-3.5 opacity-60" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pickFor !== null}
        onOpenChange={(open) => !open && setPickFor(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pick a new parent</DialogTitle>
            <DialogDescription>Pick a new parent in the merged tree.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[50vh]">
            <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-xl border border-border/80 bg-background">
              {computed.merged.map((node) => {
                const res = pickFor ? resolutions[pickFor] : undefined;
                const isSelected =
                  res?.choice === "pick_new_target" && res.newParentId === node.id;
                return (
                  <li key={node.id}>
                    <button
                      type="button"
                      className={cn(
                        "w-full cursor-pointer px-3.5 py-2.5 text-left text-xs font-medium transition-colors outline-none",
                        isSelected
                          ? "bg-primary/10 text-foreground"
                          : "text-foreground/90 hover:bg-muted/40",
                      )}
                      onClick={() => {
                        if (!pickFor) return;
                        setChoice(pickFor, {
                          choice: "pick_new_target",
                          newParentId: node.id,
                        });
                        setPickFor(null);
                      }}
                    >
                      {nodeLabel(node)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mergeDialog === "submit"}
        onOpenChange={(open) => !open && setMergeDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isSync ? "Apply sync" : "Publish merge"}</DialogTitle>
            <DialogDescription>
              {computed.counts.moves} moves · {computed.counts.edits} edits ·{" "}
              {computed.counts.creates} creates · {computed.counts.deletes} deletes ·{" "}
              {computed.counts.peers} peers
            </DialogDescription>
          </DialogHeader>
          {!isSync && (preview.stagedEmployeeCount ?? 0) > 0 ? (
            <p className="text-sm">
              This merge also publishes all {preview.stagedEmployeeCount} staged
              employee records from the directory import. Live employee conflicts block
              the merge.
            </p>
          ) : null}
          {!isSync ? (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="merge-title">Reason / Merge message</FieldLabel>
                <Input
                  id="merge-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Reason for merge / description (required)"
                  maxLength={200}
                />
              </Field>
            </FieldGroup>
          ) : (
            <p className="text-sm text-muted-foreground">
              Live changes will be pulled into your sandbox. Your unmerged work is kept
              unless you resolved a conflict differently.
            </p>
          )}
          {!isSync && prospectiveReasons.length > 0 ? (
            <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-sm">
              <p className="font-medium text-foreground">
                {prospectiveReasons.length} reportable change
                {prospectiveReasons.length === 1 ? "" : "s"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {Object.keys(changeReasonOverrides).length} of{" "}
                {prospectiveReasons.length} reasons updated
              </p>
              <Button
                type="button"
                variant="link"
                className="mt-1 h-auto p-0 text-xs"
                disabled={busy}
                onClick={() => setMergeDialog("changes")}
              >
                Review change reasons
              </Button>
            </div>
          ) : null}
          {blocking.length > 0 ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <p className="text-sm text-destructive">
                {blocking.length} unresolved conflict{blocking.length === 1 ? "" : "s"}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMergeDialog("conflicts")}
              >
                View
              </Button>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                busy || (!isSync && title.trim().length === 0) || blocking.length > 0
              }
              onClick={() => void commit()}
            >
              {busy
                ? isSync
                  ? "Applying…"
                  : "Merging…"
                : isSync
                  ? "Apply sync"
                  : "Merge to live"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={reforkOpen} onOpenChange={setReforkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-fork this sandbox?</AlertDialogTitle>
            <AlertDialogDescription>
              Re-fork discards this sandbox and copies live again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void refork()}>
              {busy ? "Re-forking…" : "Re-fork"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
