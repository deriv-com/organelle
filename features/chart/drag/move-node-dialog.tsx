"use client";

import { useState } from "react";
import { Box, Network } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type MoveMode = "subtree" | "node-only";

export interface MoveRequest {
  nodeId: string;
  kind: "header" | "seat";
  label: string;
  childCount: number;
  oldParentLabel: string;
}

export function MoveNodeDialog({
  request,
  busy,
  onConfirm,
  onClose,
}: {
  request: MoveRequest;
  busy: boolean;
  onConfirm: (mode: MoveMode) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<MoveMode>("subtree");
  const noun = request.kind === "header" ? "header" : "position";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Move {noun} {request.label}?
          </DialogTitle>
          <DialogDescription>
            It has {request.childCount}{" "}
            {request.childCount === 1 ? "child" : "children"}. Choose whether they move
            with this {noun} or stay where they are.
          </DialogDescription>
        </DialogHeader>

        <div
          className="grid grid-cols-2 gap-3.5 pt-1"
          role="radiogroup"
          aria-label="Move options"
        >
          <button
            type="button"
            role="radio"
            aria-checked={mode === "subtree"}
            onClick={() => setMode("subtree")}
            className={cn(
              "group relative flex h-full cursor-pointer flex-col items-start justify-start gap-3 rounded-xl border p-4 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              mode === "subtree"
                ? "border-primary bg-primary/10 shadow-xs"
                : "border-border/80 bg-background hover:border-border hover:bg-muted/40",
            )}
          >
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                mode === "subtree"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground group-hover:text-foreground",
              )}
            >
              <Network className="size-4.5" />
            </div>
            <div className="flex flex-col gap-1 whitespace-normal">
              <span className="text-sm font-semibold text-foreground">
                Move everything
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                This {noun} and all {request.childCount}{" "}
                {request.childCount === 1 ? "child" : "children"} come along.
              </span>
            </div>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={mode === "node-only"}
            onClick={() => setMode("node-only")}
            className={cn(
              "group relative flex h-full cursor-pointer flex-col items-start justify-start gap-3 rounded-xl border p-4 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              mode === "node-only"
                ? "border-primary bg-primary/10 shadow-xs"
                : "border-border/80 bg-background hover:border-border hover:bg-muted/40",
            )}
          >
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                mode === "node-only"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground group-hover:text-foreground",
              )}
            >
              <Box className="size-4.5" />
            </div>
            <div className="flex flex-col gap-1 whitespace-normal">
              <span className="text-sm font-semibold text-foreground">
                Move only this {noun}
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                Children stay behind under {request.oldParentLabel}.
              </span>
            </div>
          </button>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(mode)} disabled={busy}>
            {busy ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
