"use client";

/**
 * Sandbox grid: title + Create, Active | Archived tabs with
 * pagination, cards, archive / restore, delete confirm.
 */

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Archive as ArchiveIcon,
  ArchiveRestore,
  ArrowRight,
  Ellipsis,
  FlaskConical,
  Plus,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { PageLoading } from "@/components/page-state";
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
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SegmentedItem, SegmentedTrack } from "@/components/ui/segmented-control";
import { Separator } from "@/components/ui/separator";
import { useActor, useCanEdit } from "@/features/auth/auth-provider";
import { cn } from "@/lib/utils";
import { archiveSandbox, deleteSandbox, restoreSandbox } from "./actions";
import { CreateSandboxDialog } from "./create-dialog";
import { ShareSandboxDialog } from "./share-dialog";
import {
  getCachedSandboxList,
  rememberSandboxList,
  removeCachedSandbox,
  setCachedSandboxArchived,
} from "./sandbox-client-cache";
import type { SandboxListPayload, SandboxSummary, SharedSandboxSummary } from "./types";

type ListTab = "active" | "archived";

/** 12 cards = four rows at `lg:grid-cols-3`. */
export const PAGE_SIZE = 12;

export function SandboxList({
  sandboxes: initial,
  shared: initialShared = [],
}: {
  sandboxes?: SandboxSummary[];
  shared?: SharedSandboxSummary[];
}) {
  const router = useRouter();
  const actor = useActor();
  const canEdit = useCanEdit();
  const [tab, setTab] = useState<ListTab>("active");
  const [page, setPage] = useState(1);
  const [sandboxes, setSandboxes] = useState<SandboxSummary[]>(() => {
    if (initial) {
      return rememberSandboxList({ owned: initial, shared: initialShared }).owned;
    }
    return getCachedSandboxList()?.owned ?? [];
  });
  const [sharedSandboxes, setSharedSandboxes] = useState<SharedSandboxSummary[]>(() =>
    initial !== undefined ? initialShared : (getCachedSandboxList()?.shared ?? []),
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(() => {
    if (initial !== undefined) return false;
    return !getCachedSandboxList();
  });
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<{
    sandbox: SandboxSummary;
    trigger: HTMLButtonElement;
  } | null>(null);

  useEffect(() => {
    if (initial !== undefined) return;
    const cached = getCachedSandboxList();
    if (cached) {
      setSandboxes(cached.owned);
      setSharedSandboxes(cached.shared);
      if (cached.fresh) {
        setLoading(false);
        return;
      }
    }

    const controller = new AbortController();
    async function loadSandboxes() {
      setLoading(!cached);
      setError(null);
      try {
        const response = await fetch("/api/sandboxes", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error ?? "Failed to load sandboxes");
        }
        const payload = (await response.json()) as SandboxListPayload;
        rememberSandboxList(payload);
        setSandboxes(payload.owned);
        setSharedSandboxes(payload.shared);
      } catch {
        if (controller.signal.aborted) return;
        setError("Failed to load sandboxes");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadSandboxes();
    return () => controller.abort();
  }, [initial]);

  const visible = useMemo(
    () =>
      sandboxes.filter((row) => (tab === "archived" ? row.archived : !row.archived)),
    [sandboxes, tab],
  );

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const pageRows = visible.slice(
    (clampedPage - 1) * PAGE_SIZE,
    clampedPage * PAGE_SIZE,
  );

  const selectTab = (next: ListTab) => {
    setTab(next);
    setPage(1);
  };

  const remove = async (treeId: string) => {
    setBusy(true);
    try {
      const deleted = await deleteSandbox(treeId);
      if (deleted) {
        setSandboxes((rows) => rows.filter((row) => row.treeId !== treeId));
        removeCachedSandbox(treeId);
        setConfirmId(null);
        toast.success("Sandbox deleted");
      } else {
        toast.error("Couldn’t delete sandbox");
      }
    } finally {
      setBusy(false);
    }
  };

  const archive = async (treeId: string) => {
    setBusy(true);
    try {
      const ok = await archiveSandbox(treeId);
      if (ok) {
        setSandboxes((rows) =>
          rows.map((row) => (row.treeId === treeId ? { ...row, archived: true } : row)),
        );
        setCachedSandboxArchived(treeId, true);
        toast.success("Sandbox archived");
      } else {
        toast.error("Couldn’t archive sandbox");
      }
    } finally {
      setBusy(false);
    }
  };

  const restore = async (treeId: string) => {
    setBusy(true);
    try {
      const ok = await restoreSandbox(treeId);
      if (ok) {
        setSandboxes((rows) =>
          rows.map((row) =>
            row.treeId === treeId ? { ...row, archived: false } : row,
          ),
        );
        setCachedSandboxArchived(treeId, false);
        toast.success("Sandbox restored");
      } else {
        toast.error("Couldn’t restore sandbox");
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmTarget = sandboxes.find((row) => row.treeId === confirmId);
  const activeCount = sandboxes.filter((row) => !row.archived).length;
  const archivedCount = sandboxes.filter((row) => row.archived).length;

  if (loading) {
    return <PageLoading label="Loading sandboxes…" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <CreateSandboxDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ShareSandboxDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        sandboxId={shareTarget?.sandbox.treeId ?? null}
        sandboxName={shareTarget?.sandbox.name ?? null}
        returnFocus={shareTarget?.trigger}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-sm font-semibold text-foreground/80">Sandboxes</h1>
        {canEdit ? (
          <Button
            size="sm"
            className="h-9 gap-1.5 rounded-lg"
            onClick={() => setCreateOpen(true)}
          >
            <Plus data-icon="inline-start" />
            Create sandbox
          </Button>
        ) : null}
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="my-sandboxes-heading">
        <h2
          id="my-sandboxes-heading"
          className="text-sm font-medium text-foreground/80"
        >
          My sandboxes ({sandboxes.length})
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedTrack className="bg-black/[0.08]">
            <SegmentedItem
              active={tab === "active"}
              className="inline-flex items-center gap-2"
              onClick={() => selectTab("active")}
            >
              Active
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-2xs",
                  tab === "active"
                    ? "bg-primary/20 text-foreground"
                    : "bg-background text-muted-foreground",
                )}
              >
                {activeCount}
              </span>
            </SegmentedItem>
            <SegmentedItem
              active={tab === "archived"}
              className="inline-flex items-center gap-2"
              onClick={() => selectTab("archived")}
            >
              Archived
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-2xs",
                  tab === "archived"
                    ? "bg-primary/20 text-foreground"
                    : "bg-background text-muted-foreground",
                )}
              >
                {archivedCount}
              </span>
            </SegmentedItem>
          </SegmentedTrack>
          <DataTablePagination
            page={clampedPage}
            pageCount={pageCount}
            onPageChange={setPage}
            trackClassName="bg-black/[0.08]"
          />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {visible.length === 0 ? (
          <Empty className="border border-dashed bg-background">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FlaskConical />
              </EmptyMedia>
              {tab === "active" ? (
                <>
                  <EmptyTitle>
                    {canEdit ? "No sandboxes yet" : "No personal sandboxes"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {canEdit
                      ? "Create a sandbox to edit the chart without publishing."
                      : "You can open sandboxes shared with you below."}
                  </EmptyDescription>
                </>
              ) : (
                <>
                  <EmptyTitle>No archived sandboxes</EmptyTitle>
                  <EmptyDescription>
                    {canEdit
                      ? "Archived sandboxes show up here. You can restore them anytime."
                      : "You don’t have any archived sandboxes."}
                  </EmptyDescription>
                </>
              )}
            </EmptyHeader>
            {tab === "active" ? (
              <EmptyContent>
                {canEdit ? (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus data-icon="inline-start" />
                    Create sandbox
                  </Button>
                ) : null}
              </EmptyContent>
            ) : null}
          </Empty>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pageRows.map((sandbox) => {
              const isOwner = actor?.authId === sandbox.ownerAuthId;
              const hasChanges = sandbox.changeCount > 0;
              return (
                <li key={sandbox.treeId}>
                  <Card
                    className={cn(
                      "gap-5 rounded-xl border bg-background p-5 shadow-xs transition-all hover:shadow-sm",
                      sandbox.isStale
                        ? "border-amber-400/80 bg-amber-500/[0.02] hover:border-amber-500"
                        : "border-border/70 hover:border-border",
                    )}
                  >
                    <CardHeader className="p-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <CardTitle className="truncate text-base font-semibold text-foreground">
                            {sandbox.name}
                          </CardTitle>
                          <CardDescription className="mt-1 text-xs text-muted-foreground">
                            From live v{sandbox.forkedFromSeq}
                            {sandbox.isStale && sandbox.liveSeq ? (
                              <span className="font-medium text-amber-600">
                                {" "}
                                (live is v{sandbox.liveSeq})
                              </span>
                            ) : null}{" "}
                            ·{" "}
                            {new Date(sandbox.createdAt).toLocaleDateString([], {
                              month: "short",
                              day: "numeric",
                            })}
                          </CardDescription>
                        </div>
                        <div className="flex shrink-0 items-start gap-1">
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                              hasChanges
                                ? "bg-muted font-semibold text-foreground/80"
                                : "bg-muted/60 font-normal text-muted-foreground",
                            )}
                          >
                            {sandbox.changeCount}{" "}
                            {sandbox.changeCount === 1 ? "change" : "changes"}
                          </span>
                          {isOwner ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="-mr-1 -mt-1 size-7 text-muted-foreground hover:text-foreground"
                                  aria-label={`More actions for ${sandbox.name}`}
                                  disabled={busy}
                                >
                                  <Ellipsis data-icon />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {sandbox.archived ? (
                                  <DropdownMenuItem
                                    disabled={busy}
                                    onSelect={() => void restore(sandbox.treeId)}
                                  >
                                    <ArchiveRestore />
                                    Restore
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem
                                    disabled={busy}
                                    onSelect={() => void archive(sandbox.treeId)}
                                  >
                                    <ArchiveIcon />
                                    Archive
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  disabled={busy}
                                  onSelect={() => setConfirmId(sandbox.treeId)}
                                >
                                  <Trash2 />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </div>
                      </div>
                    </CardHeader>
                    <CardFooter className="flex items-center gap-2 p-0 pt-1">
                      <Button
                        size="sm"
                        className="h-8 flex-1 rounded-lg px-3 text-xs font-medium"
                        onClick={() => router.push(`/sandbox/${sandbox.treeId}`)}
                      >
                        Open sandbox
                        <ArrowRight data-icon="inline-end" />
                      </Button>
                      {isOwner ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="size-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
                          aria-label={`Share ${sandbox.name}`}
                          onClick={(event) => {
                            setShareTarget({ sandbox, trigger: event.currentTarget });
                            setShareOpen(true);
                          }}
                        >
                          <Share2 data-icon />
                        </Button>
                      ) : null}
                    </CardFooter>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Separator className="bg-border/70" />

      <section
        className="flex flex-col gap-4"
        aria-labelledby="shared-sandboxes-heading"
      >
        <h2
          id="shared-sandboxes-heading"
          className="text-sm font-medium text-foreground/80"
        >
          Shared with me ({sharedSandboxes.length})
        </h2>
        {sharedSandboxes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No shared sandboxes.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sharedSandboxes.map((sandbox) => (
              <li key={sandbox.treeId}>
                <Card className="gap-5 rounded-xl border border-border/70 bg-background p-5 shadow-xs transition-all hover:border-border hover:shadow-sm">
                  <CardHeader className="p-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base font-semibold">
                          {sandbox.name}
                        </CardTitle>
                        <CardDescription className="mt-1 truncate text-xs">
                          Shared by {sandbox.ownerName}
                        </CardDescription>
                      </div>
                      <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-semibold capitalize">
                        {sandbox.accessLevel}
                      </span>
                    </div>
                  </CardHeader>
                  <CardFooter className="p-0 pt-1">
                    <Button
                      size="sm"
                      className="h-8 w-full rounded-lg px-3 text-xs font-medium"
                      onClick={() => router.push(`/sandbox/${sandbox.treeId}`)}
                    >
                      Open sandbox
                      <ArrowRight data-icon="inline-end" />
                    </Button>
                  </CardFooter>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AlertDialog
        open={Boolean(confirmId)}
        onOpenChange={(open) => !open && setConfirmId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete permanently? This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !confirmId}
              variant="destructive"
              onClick={() => confirmId && void remove(confirmId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
