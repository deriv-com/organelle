"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";

import { PageLoading } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AppRole } from "./policy";
import { APP_ROLES, ROLE_LABEL, roleLabel } from "./policy";
import {
  getCachedRoleRows,
  rememberRoleRows,
  updateCachedRoleRow,
} from "./role-client-cache";
import type { RoleRow } from "./role-types";
import { setRole } from "./roles";

const ROLE_OPTIONS = [...APP_ROLES].reverse();
const SECTION_ORDER = ROLE_OPTIONS;
const VIEWER_PAGE = 10;

export function RolesAdmin({ initial }: { initial?: RoleRow[] }) {
  const [rows, setRows] = useState<RoleRow[]>(() => {
    if (initial) return rememberRoleRows(initial);
    return getCachedRoleRows()?.rows ?? [];
  });
  const [query, setQuery] = useState("");
  const [viewerPage, setViewerPage] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => {
    if (initial !== undefined) return false;
    return !getCachedRoleRows();
  });
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (initial !== undefined) return;
    const cached = getCachedRoleRows();
    if (cached) {
      setRows(cached.rows);
      if (cached.fresh) {
        setLoading(false);
        return;
      }
    }

    const controller = new AbortController();
    async function loadRoles() {
      setLoading(!cached);
      setLoadError(null);
      try {
        const response = await fetch("/api/admin/roles", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error ?? "Failed to load roles");
        }
        setRows(rememberRoleRows((await response.json()) as RoleRow[]));
      } catch {
        if (controller.signal.aborted) return;
        setLoadError("Failed to load roles");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadRoles();
    return () => controller.abort();
  }, [initial]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        (row.name ?? "").toLowerCase().includes(q) ||
        (row.email ?? "").toLowerCase().includes(q) ||
        roleLabel(row.role).toLowerCase().includes(q),
    );
  }, [rows, query]);

  const grouped = useMemo(() => {
    const map = new Map<AppRole, RoleRow[]>();
    for (const role of SECTION_ORDER) map.set(role, []);
    for (const row of filtered) {
      map.get(row.role)?.push(row);
    }
    return map;
  }, [filtered]);

  const change = (authId: string, next: AppRole) => {
    startTransition(async () => {
      const result = await setRole(authId, next);
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      toast.success("Role updated");
      setRows((prev) =>
        prev.map((row) => (row.authId === authId ? { ...row, role: next } : row)),
      );
      updateCachedRoleRow(authId, next);
    });
  };

  const viewers = grouped.get("viewer") ?? [];
  const viewerPages = Math.max(1, Math.ceil(viewers.length / VIEWER_PAGE));
  const page = Math.min(viewerPage, viewerPages);
  const viewerSlice = viewers.slice((page - 1) * VIEWER_PAGE, page * VIEWER_PAGE);
  const hasMatches = filtered.length > 0;

  if (loading) {
    return <PageLoading label="Loading users…" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-foreground/80">Users & Roles</h1>
          <span className="rounded-full bg-background px-2.5 py-0.5 text-xs font-semibold text-muted-foreground shadow-2xs">
            {rows.length}
          </span>
        </div>
        <InputGroup className="h-9 w-72 rounded-lg border border-input bg-background shadow-xs">
          <InputGroupAddon>
            <Search className="size-4 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setViewerPage(1);
            }}
            placeholder="Search name, email, role..."
            className="text-sm"
          />
        </InputGroup>
      </div>

      {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
      {!loadError && !hasMatches ? (
        <p className="text-sm text-muted-foreground">No people match.</p>
      ) : null}

      {!loadError
        ? SECTION_ORDER.map((role) => {
            const list = role === "viewer" ? viewerSlice : (grouped.get(role) ?? []);
            const total = grouped.get(role)?.length ?? 0;
            if (total === 0 && query.trim()) return null;
            return (
              <section key={role} className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {ROLE_LABEL[role]}
                  </h2>
                  <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-2xs">
                    {total}
                  </span>
                </div>
                {total === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/80 bg-background/50 p-4 text-center text-xs text-muted-foreground">
                    No users assigned this role.
                  </div>
                ) : (
                  <ul className="divide-y divide-black/[0.06] rounded-xl border border-border/70 bg-background shadow-xs">
                    {list.map((row) => (
                      <li
                        key={row.authId}
                        className="flex items-center gap-4 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground/90">
                            {row.name || row.email}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {row.email}
                          </p>
                        </div>
                        <Select
                          value={row.role}
                          disabled={pending}
                          onValueChange={(value) =>
                            change(row.authId, value as AppRole)
                          }
                        >
                          <SelectTrigger
                            size="sm"
                            className="h-8 w-36 rounded-lg border-input bg-background text-xs shadow-2xs"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {ROLE_OPTIONS.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {roleLabel(option)}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </li>
                    ))}
                  </ul>
                )}
                {role === "viewer" && viewerPages > 1 ? (
                  <div className="flex items-center justify-end gap-2 pt-1 text-xs text-muted-foreground">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-md px-2 text-xs"
                      disabled={page <= 1}
                      onClick={() => setViewerPage(page - 1)}
                    >
                      Previous
                    </Button>
                    <span>
                      Page {page} of {viewerPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-md px-2 text-xs"
                      disabled={page >= viewerPages}
                      onClick={() => setViewerPage(page + 1)}
                    >
                      Next
                    </Button>
                  </div>
                ) : null}
              </section>
            );
          })
        : null}
    </div>
  );
}
