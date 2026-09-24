"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { Spinner } from "@/components/ui/spinner";
import { forkSandbox } from "@/features/sandbox/actions";
import { clearSandboxClientCache } from "@/features/sandbox/sandbox-client-cache";

export function CreateSandboxDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setError(null);
    setBusy(false);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await forkSandbox(trimmed);
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      toast.success("Sandbox created");
      clearSandboxClientCache();
      onOpenChange(false);
      reset();
      router.push(`/sandbox/${result.treeId}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create sandbox</DialogTitle>
          <DialogDescription>
            Copies the live chart so you can edit without publishing.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <FieldGroup>
            <Field data-invalid={Boolean(error) || undefined}>
              <FieldLabel htmlFor="sandbox-name">Name</FieldLabel>
              <Input
                id="sandbox-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Q4 reorg"
                maxLength={80}
                autoFocus
                aria-invalid={Boolean(error)}
              />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || name.trim().length === 0}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              {busy ? "Creating…" : "Create sandbox"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
