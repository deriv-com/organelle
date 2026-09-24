"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { PageLoading } from "@/components/page-state";
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
import { Input } from "@/components/ui/input";
import { useIsAdmin } from "@/features/auth/auth-provider";
import {
  createApiKeyAction,
  revokeApiKeyAction,
  type ApiKeyRow,
} from "./api-keys-actions";
import { API_KEY_LABEL_MAX_LEN } from "./api-key-label";
import { SCOPE_CATALOG, type ScopeDoc } from "./scope-catalog";
import { STRUCTURE_HEADERS_READ, type IntegrationScope } from "./scopes";

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

type IntegrationsDocsPanelProps = {
  selectedScope: IntegrationScope;
  onSelectScope: (scope: IntegrationScope) => void;
  onScopeLinkClick?: (scope: IntegrationScope) => void;
};

function IntegrationsDocsPanel({
  selectedScope,
  onSelectScope,
  onScopeLinkClick,
}: IntegrationsDocsPanelProps) {
  const doc =
    SCOPE_CATALOG.find((entry) => entry.id === selectedScope) ?? SCOPE_CATALOG[0]!;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 lg:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-foreground/90">API reference</h2>
        <p className="text-xs text-muted-foreground">
          For applications calling Organelle. Authenticate with an Organelle Bearer API
          key; interactive OIDC sessions are not accepted on v1 machine routes.
        </p>
      </div>

      <nav className="flex flex-col gap-1" aria-label="API scopes">
        {SCOPE_CATALOG.map((entry) => {
          const selected = entry.id === selectedScope;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                onSelectScope(entry.id);
                onScopeLinkClick?.(entry.id);
              }}
              className={`rounded-lg px-3 py-2 text-left transition-colors ${
                selected
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              <p className="font-mono text-[11px]">{entry.id}</p>
              <p className="text-xs">{entry.title}</p>
            </button>
          );
        })}
      </nav>

      <ScopeDocDetail doc={doc} />
    </div>
  );
}

function ScopeDocDetail({ doc }: { doc: ScopeDoc }) {
  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(doc.requestExample);
      toast.success("Copied curl example");
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border/70 bg-background p-4 shadow-xs">
      <div>
        <h3 className="text-sm font-semibold text-foreground/90">{doc.title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{doc.summary}</p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          URL
        </p>
        <a
          href={doc.productionUrl}
          className="rounded-md bg-muted/50 px-2 py-1.5 font-mono text-xs break-all text-primary underline-offset-2 hover:underline"
        >
          {doc.method} {doc.productionUrl}
        </a>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Auth
        </p>
        <ul className="list-inside list-disc text-xs text-muted-foreground">
          <li>
            Header:{" "}
            <code className="text-[11px]">Authorization: Bearer &lt;api_key&gt;</code>
          </li>
          <li>
            Required scope: <code className="text-[11px]">{doc.requiredScope}</code>
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Request example
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={copyCurl}
          >
            Copy curl
          </Button>
        </div>
        <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
          {doc.requestExample}
        </pre>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Response
        </p>
        <ul className="list-inside list-disc text-xs text-muted-foreground">
          {doc.responseNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed whitespace-pre">
          {doc.responseExample}
        </pre>
      </div>
    </section>
  );
}

type IntegrationsKeysPanelProps = {
  rows: ApiKeyRow[];
  loadError: string | null;
  pending: boolean;
  isAdmin: boolean;
  selectedScopes: IntegrationScope[];
  onToggleScope: (scope: IntegrationScope) => void;
  label: string;
  onLabelChange: (value: string) => void;
  onCreate: () => void;
  onRevoke: (keyId: string) => void;
};

function IntegrationsKeysPanel({
  rows,
  loadError,
  pending,
  isAdmin,
  selectedScopes,
  onToggleScope,
  label,
  onLabelChange,
  onCreate,
  onRevoke,
}: IntegrationsKeysPanelProps) {
  const active = useMemo(
    () =>
      rows.filter((row) => !row.revokedAt && Date.parse(row.expiresAt) > Date.now()),
    [rows],
  );
  const revoked = useMemo(
    () =>
      rows.filter((row) => row.revokedAt || Date.parse(row.expiresAt) <= Date.now()),
    [rows],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 lg:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-foreground/80">API keys</h2>
        <p className="text-xs text-muted-foreground">
          Choose scopes when creating a key. Each key only accesses endpoints for its
          scopes.
          {isAdmin
            ? " Admins see every key and who created it."
            : " You only see keys you created."}
        </p>
      </div>

      <form
        className="flex flex-col gap-4 rounded-xl border border-border/70 bg-background p-4 shadow-xs"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate();
        }}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <label
            htmlFor="api-key-label"
            className="text-xs font-medium text-muted-foreground"
          >
            Label
          </label>
          <Input
            id="api-key-label"
            value={label}
            onChange={(event) => onLabelChange(event.target.value)}
            placeholder="e.g. payroll-sync"
            disabled={pending}
            required
            maxLength={API_KEY_LABEL_MAX_LEN}
          />
          <p className="text-xs text-muted-foreground">
            {label.length}/{API_KEY_LABEL_MAX_LEN}
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium text-muted-foreground">Scopes</legend>
          {SCOPE_CATALOG.map((entry) => {
            const checked = selectedScopes.includes(entry.id);
            return (
              <label
                key={entry.id}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/60 px-3 py-2.5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
              >
                <Checkbox
                  checked={checked}
                  disabled={pending}
                  onCheckedChange={() => onToggleScope(entry.id)}
                  aria-label={entry.id}
                />
                <span className="min-w-0 flex flex-col gap-0.5">
                  <span className="font-mono text-[11px] text-foreground/90">
                    {entry.id}
                  </span>
                  <span className="text-xs text-muted-foreground">{entry.summary}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <Button
          type="submit"
          disabled={pending || !label.trim() || selectedScopes.length === 0}
          className="h-9 self-start"
        >
          Create key
        </Button>
      </form>

      {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Active
          </h3>
          <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-2xs">
            {active.length}
          </span>
        </div>
        {active.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-background/50 p-4 text-center text-xs text-muted-foreground">
            No active keys.
          </div>
        ) : (
          <ul className="divide-y divide-black/[0.06] rounded-xl border border-border/70 bg-background shadow-xs">
            {active.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground/90">
                    {row.label}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {row.keyPrefix}…
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Created {formatWhen(row.createdAt)} · Expires{" "}
                    {formatWhen(row.expiresAt)} · {row.scopes.join(", ")}
                    {isAdmin
                      ? ` · ${row.createdByName || row.createdByEmail || row.createdBy}`
                      : null}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={pending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Revoke key “${row.label}”? This cannot be undone.`,
                      )
                    ) {
                      onRevoke(row.id);
                    }
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {revoked.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Inactive
            </h3>
            <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-2xs">
              {revoked.length}
            </span>
          </div>
          <ul className="divide-y divide-black/[0.06] rounded-xl border border-border/70 bg-background/60 shadow-xs opacity-80">
            {revoked.map((row) => (
              <li key={row.id} className="px-4 py-3">
                <p className="truncate text-sm font-medium text-foreground/70">
                  {row.label}
                </p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {row.keyPrefix}…
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {row.revokedAt
                    ? `Revoked ${formatWhen(row.revokedAt)}`
                    : `Expired ${formatWhen(row.expiresAt)}`}
                  {isAdmin
                    ? ` · ${row.createdByName || row.createdByEmail || row.createdBy}`
                    : null}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function IntegrationsPage() {
  const isAdmin = useIsAdmin();
  const [rows, setRows] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<IntegrationScope[]>([
    STRUCTURE_HEADERS_READ,
  ]);
  const [docsScope, setDocsScope] = useState<IntegrationScope>(STRUCTURE_HEADERS_READ);
  const [pending, startTransition] = useTransition();
  const [secretOnce, setSecretOnce] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch("/api/integrations/keys", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error ?? "Failed to load API keys");
        }
        setRows((await response.json()) as ApiKeyRow[]);
      } catch {
        if (controller.signal.aborted) return;
        setLoadError("Failed to load API keys");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  const toggleScope = (scope: IntegrationScope) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const linkScopeToCreateForm = (scope: IntegrationScope) => {
    setSelectedScopes((prev) => (prev.includes(scope) ? prev : [...prev, scope]));
  };

  const create = () => {
    startTransition(async () => {
      const result = await createApiKeyAction(label, selectedScopes);
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      setRows((prev) => [result.row, ...prev]);
      setLabel("");
      setSecretOnce(result.secret);
      toast.success("API key created");
    });
  };

  const revoke = (keyId: string) => {
    startTransition(async () => {
      const result = await revokeApiKeyAction(keyId);
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      setRows((prev) =>
        prev.map((row) =>
          row.id === keyId ? { ...row, revokedAt: new Date().toISOString() } : row,
        ),
      );
      toast.success("API key revoked");
    });
  };

  if (loading) {
    return <PageLoading label="Loading Integrations…" />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-col gap-1 px-0">
        <h1 className="text-sm font-semibold text-foreground/80">Integrations</h1>
        <p className="text-xs text-muted-foreground">
          Machine access to the published org structure for internal apps.
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-hidden rounded-xl border border-border/70 bg-border lg:grid-cols-2">
        <div className="min-h-0 bg-background">
          <IntegrationsDocsPanel
            selectedScope={docsScope}
            onSelectScope={setDocsScope}
            onScopeLinkClick={linkScopeToCreateForm}
          />
        </div>
        <div className="min-h-0 bg-background">
          <IntegrationsKeysPanel
            rows={rows}
            loadError={loadError}
            pending={pending}
            isAdmin={isAdmin}
            selectedScopes={selectedScopes}
            onToggleScope={toggleScope}
            label={label}
            onLabelChange={setLabel}
            onCreate={create}
            onRevoke={revoke}
          />
        </div>
      </div>

      <Dialog
        open={Boolean(secretOnce)}
        onOpenChange={(open) => !open && setSecretOnce(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your API key</DialogTitle>
            <DialogDescription>
              This secret is shown once. Store it in your consumer app’s secret manager.
            </DialogDescription>
          </DialogHeader>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs break-all whitespace-pre-wrap">
            {secretOnce}
          </pre>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                if (!secretOnce) return;
                try {
                  await navigator.clipboard.writeText(secretOnce);
                  toast.success("Copied");
                } catch {
                  toast.error("Could not copy");
                }
              }}
            >
              Copy
            </Button>
            <Button type="button" onClick={() => setSecretOnce(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
