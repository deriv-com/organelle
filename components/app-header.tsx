"use client";

/**
 * Three-slot app header: nav or sandbox chrome | logo | page actions.
 */

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  FlaskConical,
  GitMerge,
  History,
  Menu,
  Pencil,
  Share2,
  Undo2,
  Redo2,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";

import { DownloadSeatExportButton } from "@/features/reports/download-seat-export-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { SegmentedTrack, segmentedItemClass } from "@/components/ui/segmented-control";
import {
  useActor,
  useCanEdit,
  useCanExport,
  useCanRestore,
} from "@/features/auth/auth-provider";
import { isNavActive, navItemsForRole } from "@/features/auth/nav";
import { closeSandboxHistorySheet } from "@/features/chart/view-on-chart";
import { attachPersistUnload } from "@/features/chart/persist-unload";
import { CreateSandboxDialog } from "@/features/sandbox/create-dialog";
import { ShareSandboxDialog } from "@/features/sandbox/share-dialog";
import { VersionsHeaderActions } from "@/features/reports/changes/versions-header-actions";
import { restoreVersion } from "@/features/versions/actions";
import { useOrgData } from "@/store/org-data";
import {
  filterVisibleChartMembers,
  uniqueEmployeeCount,
} from "@/features/chart/chart-row";

function PersistStatus() {
  const persistPhase = useOrgData((state) => state.persistPhase);
  const clearSaved = useOrgData((state) => state.clearSaved);

  useEffect(() => {
    if (persistPhase !== "saved") return;
    const timer = setTimeout(() => clearSaved(), 1200);
    return () => clearTimeout(timer);
  }, [persistPhase, clearSaved]);

  useEffect(() => {
    if (persistPhase !== "saving") return;
    return attachPersistUnload(() => useOrgData.getState().persistPhase);
  }, [persistPhase]);

  if (persistPhase === "idle") return null;
  const saving = persistPhase === "saving";
  return (
    <Badge variant={saving ? "secondary" : "default"} className="gap-1.5">
      {saving ? <Spinner /> : null}
      {saving ? "Saving" : "Saved"}
    </Badge>
  );
}

function MainNav({ hasSandboxAccess }: { hasSandboxAccess: boolean }) {
  const pathname = usePathname();
  const actor = useActor();
  if (!actor) return null;
  const items = navItemsForRole(actor.role, hasSandboxAccess);
  const activeItem = items.find((item) => isNavActive(pathname, item.href));
  const primaryItems = items.filter(
    (item) =>
      item.href === "/chart" ||
      item.href === "/directory" ||
      item.href === "/sandboxes",
  );
  const overflowItems = items.filter((item) => !primaryItems.includes(item));
  const overflowActive = overflowItems.some((item) => isNavActive(pathname, item.href));
  return (
    <>
      <nav aria-label="Primary navigation" className="hidden lg:block">
        <SegmentedTrack>
          {primaryItems.map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={segmentedItemClass(active, "whitespace-nowrap")}
              >
                {item.label}
              </Link>
            );
          })}
          {overflowItems.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More navigation"
                  className={segmentedItemClass(
                    overflowActive,
                    "flex items-center gap-1 whitespace-nowrap",
                  )}
                >
                  More
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-52">
                {overflowItems.map((item) => {
                  const active = isNavActive(pathname, item.href);
                  return (
                    <DropdownMenuItem
                      key={item.href}
                      asChild
                      className={
                        active ? "bg-accent text-accent-foreground" : undefined
                      }
                    >
                      <Link href={item.href} aria-current={active ? "page" : undefined}>
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </SegmentedTrack>
      </nav>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="lg:hidden"
            aria-label="Open navigation"
          >
            <Menu aria-hidden="true" />
            <span className="hidden max-w-36 truncate sm:inline">
              {activeItem?.label ?? "Navigation"}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          {items.map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <DropdownMenuItem
                key={item.href}
                asChild
                className={active ? "bg-accent text-accent-foreground" : undefined}
              >
                <Link href={item.href} aria-current={active ? "page" : undefined}>
                  {item.label}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function HeadcountBadge() {
  const treeKind = useOrgData((state) => state.treeKind);
  const chartRows = useOrgData((state) => state.chartRows);
  const directoryRows = useOrgData((state) => state.directoryRows);
  if (treeKind !== "published") return null;

  const count =
    chartRows.length > 0
      ? uniqueEmployeeCount(filterVisibleChartMembers(chartRows))
      : new Set(
          directoryRows
            .filter(
              (row) => row.host.status !== "inactive" && row.host.status !== "resigned",
            )
            .map((row) => row.host.authId),
        ).size;

  if (count === 0) return null;
  return (
    <div
      aria-label={`${count} employees`}
      className="hidden h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 shadow-sm min-[1200px]:inline-flex"
    >
      <UsersRound className="size-3.5 text-slate-500" aria-hidden="true" />
      <span className="font-semibold tabular-nums text-slate-900">{count}</span>
      <span>employees</span>
    </div>
  );
}

function PublishedDateLabel() {
  const treeKind = useOrgData((state) => state.treeKind);
  const publishedAt = useOrgData((state) => state.publishedAt);
  if (treeKind !== "published" || !publishedAt) return null;

  const label = new Date(publishedAt).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <span className="hidden whitespace-nowrap text-xs font-medium text-muted-foreground min-[1400px]:inline">
      Updated {label}
    </span>
  );
}

function LiveActions() {
  const canEdit = useCanEdit();
  const canExport = useCanExport();
  const [createOpen, setCreateOpen] = useState(false);
  if (!canEdit && !canExport) {
    return (
      <div className="flex items-center justify-end gap-3">
        <HeadcountBadge />
        <PublishedDateLabel />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-end gap-2">
      <HeadcountBadge />
      <PublishedDateLabel />
      {canExport ? <DownloadSeatExportButton size="icon-sm" /> : null}
      {canEdit ? (
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Pencil data-icon="inline-start" />
          Edit
        </Button>
      ) : null}
      <CreateSandboxDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function VersionChartActions() {
  const router = useRouter();
  const canRestore = useCanRestore();
  const treeId = useOrgData((state) => state.treeId);
  const treeKind = useOrgData((state) => state.treeKind);
  const versionSeq = useOrgData((state) => state.versionSeq);
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  const historical = treeKind === "historical";

  const restore = () => {
    if (!treeId) return;
    startTransition(async () => {
      const result = await restoreVersion(treeId);
      if (!result.ok) {
        toast.error(result.reason);
        setConfirm(false);
        return;
      }
      toast.success("Published as a new live version");
      router.push("/chart");
    });
  };

  return (
    <div className="flex items-center justify-end gap-2">
      <Badge variant="secondary">
        {versionSeq != null ? `v${versionSeq}` : "Version"}
        {treeKind === "published" ? " · Live" : ""}
      </Badge>
      {historical && canRestore ? (
        <>
          <Button size="sm" onClick={() => setConfirm(true)}>
            Restore
          </Button>
          <AlertDialog open={confirm} onOpenChange={setConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Publish this as a new live version?</AlertDialogTitle>
                <AlertDialogDescription>
                  It becomes v{versionSeq != null ? versionSeq + 1 : "next"}. You can
                  restore another version later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                <AlertDialogAction disabled={pending} onClick={restore}>
                  {pending ? "Publishing…" : "Publish"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </div>
  );
}

function SandboxLeft() {
  const pathname = usePathname();
  const router = useRouter();
  const actor = useActor();
  const loadedTreeId = useOrgData((state) => state.treeId);
  const sandboxName = useOrgData((state) => state.sandboxName);
  const sandboxOwnerAuthId = useOrgData((state) => state.sandboxOwnerAuthId);
  const sandboxArchived = useOrgData((state) => state.sandboxArchived);
  const sandboxEditable = useOrgData((state) => state.sandboxEditable);
  const mergeMatch = pathname.match(/^\/sandbox\/([^/]+)\/merge$/);
  const syncMatch = pathname.match(/^\/sandbox\/([^/]+)\/sync$/);
  const reviewMatch = mergeMatch ?? syncMatch;
  const sandboxMatch = pathname.match(/^\/sandbox\/([^/]+)$/);
  const sandboxId = reviewMatch?.[1] ?? sandboxMatch?.[1];
  const accessReady = Boolean(sandboxId && loadedTreeId === sandboxId);
  const backHref = reviewMatch ? `/sandbox/${sandboxId}` : "/sandboxes";
  const isSharedEditor = Boolean(
    !reviewMatch &&
    accessReady &&
    sandboxEditable &&
    actor &&
    sandboxOwnerAuthId &&
    actor.authId !== sandboxOwnerAuthId,
  );
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          closeSandboxHistorySheet();
          router.push(backHref);
        }}
      >
        <ArrowLeft data-icon="inline-start" />
        Back
      </Button>
      <span className="truncate text-sm font-medium">
        {accessReady ? (sandboxName ?? "Sandbox") : "Sandbox"}
      </span>
      {accessReady && sandboxArchived && !reviewMatch ? (
        <Badge variant="secondary">Archived</Badge>
      ) : accessReady && !sandboxEditable && !reviewMatch ? (
        <Badge variant="secondary">View only</Badge>
      ) : isSharedEditor ? (
        <Badge variant="secondary">Editor</Badge>
      ) : null}
    </div>
  );
}

function SandboxEditActions() {
  const pathname = usePathname();
  const router = useRouter();
  const loadedTreeId = useOrgData((state) => state.treeId);
  const editable = useOrgData((state) => state.sandboxEditable);
  const canPublish = useOrgData((state) => state.sandboxCanPublish);
  const canShare = useOrgData((state) => state.sandboxCanShare);
  const canReadHistory = useOrgData((state) => state.sandboxCanReadHistory);
  const setHistoryOpen = useOrgData((state) => state.setHistoryOpen);
  const canUndo = useOrgData((state) => state.canUndo);
  const canRedo = useOrgData((state) => state.canRedo);
  const sandboxName = useOrgData((state) => state.sandboxName);
  const requestUndo = useOrgData((state) => state.requestUndo);
  const requestRedo = useOrgData((state) => state.requestRedo);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTrigger, setShareTrigger] = useState<HTMLButtonElement | null>(null);
  const sandboxMatch = pathname.match(/^\/sandbox\/([^/]+)$/);
  if (!sandboxMatch) return null;
  const sandboxId = sandboxMatch[1]!;
  if (loadedTreeId !== sandboxId) return null;
  const shareButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={(event) => {
        setShareTrigger(event.currentTarget);
        setShareOpen(true);
      }}
    >
      <Share2 data-icon="inline-start" />
      Share
    </Button>
  );
  const shareDialog = (
    <ShareSandboxDialog
      open={shareOpen}
      onOpenChange={setShareOpen}
      sandboxId={sandboxId}
      sandboxName={sandboxName}
      returnFocus={shareTrigger}
    />
  );
  const publishButton = canPublish ? (
    <Button size="sm" onClick={() => router.push(`/sandbox/${sandboxId}/merge`)}>
      <GitMerge data-icon="inline-start" />
      Publish
    </Button>
  ) : null;
  if (!editable) {
    return (
      <div className="flex items-center justify-end gap-2">
        {canReadHistory ? (
          <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
            <History data-icon="inline-start" />
            Changes
          </Button>
        ) : null}
        {canShare ? shareButton : null}
        {publishButton}
        {canShare ? shareDialog : null}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-end gap-2">
      <PersistStatus />
      <Button
        variant="ghost"
        size="icon"
        disabled={!canUndo}
        onClick={() => requestUndo()}
      >
        <Undo2 data-icon />
        <span className="sr-only">Undo</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={!canRedo}
        onClick={() => requestRedo()}
      >
        <Redo2 data-icon />
        <span className="sr-only">Redo</span>
      </Button>
      {canReadHistory ? (
        <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
          <History data-icon="inline-start" />
          Changes
        </Button>
      ) : null}
      {canShare ? shareButton : null}
      {publishButton}
      {canShare ? shareDialog : null}
    </div>
  );
}

function SyncActions() {
  const mergeChrome = useOrgData((state) => state.mergeChrome);
  const setMergeDialog = useOrgData((state) => state.setMergeDialog);
  if (!mergeChrome) return null;
  return (
    <div className="flex items-center justify-end gap-2">
      {mergeChrome.conflictCount > 0 ? (
        <Button variant="outline" size="sm" onClick={() => setMergeDialog("conflicts")}>
          Conflicts ({mergeChrome.conflictCount})
        </Button>
      ) : null}
      <Button variant="outline" size="sm" onClick={() => setMergeDialog("details")}>
        Changes ({mergeChrome.changeCount})
      </Button>
      <Button size="sm" onClick={() => setMergeDialog("submit")}>
        Apply sync
      </Button>
    </div>
  );
}

function MergeActions() {
  const mergeChrome = useOrgData((state) => state.mergeChrome);
  const setMergeDialog = useOrgData((state) => state.setMergeDialog);
  if (!mergeChrome) return null;
  return (
    <div className="flex items-center justify-end gap-2">
      {mergeChrome.conflictCount > 0 ? (
        <Button variant="outline" size="sm" onClick={() => setMergeDialog("conflicts")}>
          Conflicts ({mergeChrome.conflictCount})
        </Button>
      ) : null}
      <Button variant="outline" size="sm" onClick={() => setMergeDialog("details")}>
        Changes ({mergeChrome.changeCount})
      </Button>
      <Button size="sm" onClick={() => setMergeDialog("submit")}>
        Submit merge
      </Button>
    </div>
  );
}

function LeftSlot({ hasSandboxAccess }: { hasSandboxAccess: boolean }) {
  const pathname = usePathname();
  if (pathname.startsWith("/sandbox/")) return <SandboxLeft />;
  return <MainNav hasSandboxAccess={hasSandboxAccess} />;
}

function RightSlot() {
  const pathname = usePathname();
  const canEdit = useCanEdit();
  const [createOpen, setCreateOpen] = useState(false);

  if (pathname.startsWith("/sandbox/") && pathname.endsWith("/merge"))
    return <MergeActions />;
  if (pathname.startsWith("/sandbox/") && pathname.endsWith("/sync"))
    return <SyncActions />;
  if (/^\/sandbox\/[^/]+$/.test(pathname)) return <SandboxEditActions />;
  if (/^\/versions\/[^/]+$/.test(pathname)) return <VersionChartActions />;
  if (pathname === "/sandboxes") {
    return (
      <div className="flex justify-end">
        {canEdit ? (
          <>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <FlaskConical data-icon="inline-start" />
              Create sandbox
            </Button>
            <CreateSandboxDialog open={createOpen} onOpenChange={setCreateOpen} />
          </>
        ) : null}
      </div>
    );
  }
  if (pathname === "/versions") return <VersionsHeaderActions />;
  if (pathname === "/changes") return null;
  if (pathname.startsWith("/admin")) return null;
  if (pathname.startsWith("/chart") || pathname.startsWith("/directory"))
    return <LiveActions />;
  return null;
}

export function AppHeader({
  hasSandboxAccess = false,
  organizationName = "Organelle",
}: {
  hasSandboxAccess?: boolean;
  organizationName?: string;
}) {
  const pathname = usePathname();
  const sandboxChrome = pathname.startsWith("/sandbox/");

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 sm:gap-4 sm:px-4 min-[1800px]:grid min-[1800px]:grid-cols-[1fr_auto_1fr]">
      <div className="order-2 min-w-0 flex-1 min-[1800px]:order-1">
        <LeftSlot hasSandboxAccess={hasSandboxAccess} />
      </div>
      <Link
        href="/chart"
        aria-label={`${organizationName} home`}
        className={`${
          sandboxChrome ? "hidden md:flex" : "flex"
        } order-1 min-w-0 max-w-40 shrink-0 items-center gap-2 text-foreground min-[1800px]:order-2 min-[1800px]:flex min-[1800px]:max-w-none`}
      >
        <Image
          src="/icon.png"
          alt=""
          width={24}
          height={24}
          className="size-6 object-contain"
        />
        <span className="truncate text-sm font-bold tracking-tight">
          {organizationName}
        </span>
      </Link>
      <div className="order-3 min-w-0 shrink-0">
        <RightSlot />
      </div>
    </header>
  );
}
