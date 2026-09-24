"use client";

import { useState } from "react";
import { CornerDownRight, UserRound, Users } from "lucide-react";

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
import type { MemberPeerDrop, PeerDrop } from "./apply";

export type SeatDropIntent = "child" | "peer" | "assistant";

export interface PeerOrChildRequest {
  drop: PeerDrop | MemberPeerDrop;
  sourceLabel: string;
  targetLabel: string;
  memberLabel: string | null;
}

export function PeerOrChildDialog({
  request,
  busy,
  onConfirm,
  onClose,
}: {
  request: PeerOrChildRequest;
  busy: boolean;
  onConfirm: (intent: SeatDropIntent) => void;
  onClose: () => void;
}) {
  const [intent, setIntent] = useState<SeatDropIntent>("peer");
  const who = request.memberLabel ?? request.sourceLabel;
  const childCopy = request.memberLabel
    ? `Move ${who} under ${request.targetLabel} as a new position.`
    : `Move ${who} under ${request.targetLabel}.`;
  const peerCopy = request.memberLabel
    ? `Add ${who} as a peer of ${request.targetLabel}.`
    : `Merge ${who} onto ${request.targetLabel} as a peer.`;
  const assistantCopy = `Place ${who} as the assistant of ${request.targetLabel}.`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Place {who}?</DialogTitle>
          <DialogDescription>
            Dropped on the peer zone of {request.targetLabel}.
          </DialogDescription>
        </DialogHeader>

        <div
          className="grid grid-cols-3 gap-3 pt-1"
          role="radiogroup"
          aria-label="Placement options"
        >
          <button
            type="button"
            role="radio"
            aria-checked={intent === "child"}
            onClick={() => setIntent("child")}
            className={cn(
              "group relative flex h-full cursor-pointer flex-col items-start justify-start gap-3 rounded-xl border p-4 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              intent === "child"
                ? "border-primary bg-primary/10 shadow-xs"
                : "border-border/80 bg-background hover:border-border hover:bg-muted/40",
            )}
          >
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                intent === "child"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground group-hover:text-foreground",
              )}
            >
              <CornerDownRight className="size-4.5" />
            </div>
            <div className="flex flex-col gap-1 whitespace-normal">
              <span className="text-sm font-semibold text-foreground">
                Move as a child
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {childCopy}
              </span>
            </div>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={intent === "peer"}
            onClick={() => setIntent("peer")}
            className={cn(
              "group relative flex h-full cursor-pointer flex-col items-start justify-start gap-3 rounded-xl border p-4 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              intent === "peer"
                ? "border-primary bg-primary/10 shadow-xs"
                : "border-border/80 bg-background hover:border-border hover:bg-muted/40",
            )}
          >
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                intent === "peer"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground group-hover:text-foreground",
              )}
            >
              <Users className="size-4.5" />
            </div>
            <div className="flex flex-col gap-1 whitespace-normal">
              <span className="text-sm font-semibold text-foreground">
                Add as a peer
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {peerCopy}
              </span>
            </div>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={intent === "assistant"}
            onClick={() => setIntent("assistant")}
            className={cn(
              "group relative flex h-full cursor-pointer flex-col items-start justify-start gap-3 rounded-xl border p-4 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              intent === "assistant"
                ? "border-primary bg-primary/10 shadow-xs"
                : "border-border/80 bg-background hover:border-border hover:bg-muted/40",
            )}
          >
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                intent === "assistant"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground group-hover:text-foreground",
              )}
            >
              <UserRound className="size-4.5" />
            </div>
            <div className="flex flex-col gap-1 whitespace-normal">
              <span className="text-sm font-semibold text-foreground">
                Place as assistant
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {assistantCopy}
              </span>
            </div>
          </button>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(intent)} disabled={busy}>
            {busy ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
