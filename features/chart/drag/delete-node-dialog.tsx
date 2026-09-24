"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface DeleteRequest {
  nodeId: string;
  kind: "header" | "seat";
  label: string;
  childCount: number;
  memberCount: number;
  grandparentLabel: string;
}

export function DeleteNodeDialog({
  request,
  busy,
  onConfirm,
  onClose,
}: {
  request: DeleteRequest;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const noun = request.kind === "header" ? "team" : "position";
  const consequences: string[] = [];
  if (request.childCount > 0) {
    consequences.push(
      `Its ${request.childCount} ${request.childCount === 1 ? "child" : "children"} will move up under ${request.grandparentLabel}.`,
    );
  }
  if (request.memberCount > 0) {
    consequences.push(
      `${request.memberCount} ${request.memberCount === 1 ? "person" : "people"} will lose this seat.`,
    );
  }
  if (consequences.length === 0) consequences.push("It has no children or members.");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Delete {noun} {request.label}?
          </DialogTitle>
          <DialogDescription>This is permanent in this sandbox.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          {consequences.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
