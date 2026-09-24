"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
import { cn } from "@/lib/utils";
import { reForkSandbox } from "./actions";

export function StaleBanner({
  sandboxTreeId,
  forkedFromSeq,
  liveSeq,
  className,
}: {
  sandboxTreeId: string;
  forkedFromSeq: number;
  liveSeq: number;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const behind = liveSeq - forkedFromSeq;
  if (behind <= 0) return null;

  const refork = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await reForkSandbox(sandboxTreeId);
      if (result.ok) router.push(`/sandbox/${result.treeId}`);
      else setError(result.reason);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          "pointer-events-auto flex max-w-[min(100vw-2rem,36rem)] flex-wrap items-center gap-2 rounded-xl border border-amber-400/80 bg-background/95 px-3 py-2 shadow-sm backdrop-blur-sm",
          className,
        )}
      >
        <p className="text-xs font-medium text-foreground">
          Based on v{forkedFromSeq}. Live is now v{liveSeq}
        </p>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          · {behind} merge{behind === 1 ? "" : "s"} since
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            className="h-7 rounded-lg border-border/80 bg-background px-2.5 text-xs shadow-xs"
            onClick={() => setConfirm(true)}
          >
            Re-fork
          </Button>
          <Button asChild size="sm" className="h-7 rounded-lg px-2.5 text-xs">
            <Link href={`/sandbox/${sandboxTreeId}/sync`}>Sync from live</Link>
          </Button>
        </div>
        {error ? <p className="w-full text-xs text-destructive">{error}</p> : null}
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-fork this sandbox?</AlertDialogTitle>
            <AlertDialogDescription>
              Re-fork discards this sandbox and copies current live.
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
    </>
  );
}
