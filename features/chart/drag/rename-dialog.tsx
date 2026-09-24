"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export interface RenameRequest {
  nodeId: string;
  name: string;
}

export function RenameTeamDialog({
  request,
  busy,
  onConfirm,
  onClose,
}: {
  request: RenameRequest;
  busy: boolean;
  onConfirm: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(request.name);
  const trimmed = name.trim();
  const canSave = !busy && trimmed.length > 0 && trimmed !== request.name;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename team</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) onConfirm(trimmed);
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="rename-team">Team name</FieldLabel>
              <Input
                id="rename-team"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                onFocus={(event) => event.target.select()}
              />
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => canSave && onConfirm(trimmed)} disabled={!canSave}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
