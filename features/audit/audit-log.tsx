"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Info, ListFilter, RefreshCw, Search, X } from "lucide-react";

import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { DataTableShell } from "@/components/data-table/data-table-shell";
import { personInitials } from "@/components/data-table/person-cell";
import { PageLoading } from "@/components/page-state";
import {
  dataTableBodyClass,
  dataTableCellPad,
  dataTableHeadClass,
  dataTableRowClass,
} from "@/components/data-table/styles";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import {
  AUDIT_PAGE_SIZE,
  parseAuditFilters,
  type AuditFilters,
  type AuditScope,
} from "./filters";
import { auditScopeLabel, formatAuditEvent, type AuditEvent } from "./format";
import {
  auditCacheKey,
  clearAuditClientCache,
  getCachedAuditPayload,
  rememberAuditPayload,
  type AuditPayload,
} from "./audit-client-cache";
import type { AuditActorOption, AuditOpOption, AuditPageData } from "./types";

const COLUMNS = [
  { label: "Timestamp", className: "w-[13.5rem]" },
  { label: "Type", className: "w-[14rem]" },
  { label: "Performed by", className: "w-[17rem] min-w-[220px]" },
  { label: "Details", className: "min-w-[24rem]" },
] as const;

const cellClass = cn(dataTableCellPad, "whitespace-normal align-top break-words");
const headClass = cn(
  dataTableHeadClass,
  dataTableCellPad,
  "sticky top-0 z-20 whitespace-normal bg-muted shadow-[0_1px_0_0_rgba(0,0,0,0.06)]",
);
const filterTriggerClass =
  "h-9 rounded-md border border-input bg-background text-sm shadow-xs";

type ActiveAuditFilterTag = {
  key: string;
  label: string;
  value: string;
  clear: Partial<AuditFilters>;
};

function formatAuditTime(value: string): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildParams(
  filters: AuditFilters,
  patch: Partial<AuditFilters>,
): URLSearchParams {
  const next = { ...filters, ...patch };
  const params = new URLSearchParams();
  if (next.scope !== "all") params.set("scope", next.scope);
  if (next.query.trim()) params.set("q", next.query.trim());
  if (next.actor) params.set("actor", next.actor);
  if (next.op) params.set("op", next.op);
  if (next.page > 1) params.set("page", String(next.page));
  return params;
}

function filtersFromPatch(
  filters: AuditFilters,
  patch: Partial<AuditFilters>,
): AuditFilters {
  return parseAuditFilters(buildParams(filters, patch));
}

function auditUrl(filters: AuditFilters): string {
  const params = buildParams(filters, {});
  const search = params.toString();
  return search ? `/audit?${search}` : "/audit";
}

async function fetchAuditPayload(
  filters: AuditFilters,
  signal?: AbortSignal,
): Promise<AuditPayload> {
  const response = await fetch(auditUrl(filters).replace("/audit", "/api/audit"), {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Failed to load audit log");
  return (await response.json()) as AuditPayload;
}

function AuditFiltersBar({
  filters,
  actors,
  ops,
  onNavigate,
}: {
  filters: AuditFilters;
  actors: AuditActorOption[];
  ops: AuditOpOption[];
  onNavigate: (patch: Partial<AuditFilters>) => void;
}) {
  const [query, setQuery] = useState(filters.query);

  useEffect(() => {
    setQuery(filters.query);
  }, [filters.query]);

  const navigate = (patch: Partial<AuditFilters>) => {
    onNavigate({ query, ...patch, page: patch.page ?? 1 });
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate({ query });
  };

  useEffect(() => {
    if (query === filters.query) return;
    const timer = window.setTimeout(() => {
      onNavigate({ query, page: 1 });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters.query, onNavigate, query]);

  const actorLabel =
    actors.find((actor) => actor.authId === filters.actor)?.name ?? filters.actor;
  const opLabel = ops.find((op) => op.op === filters.op)?.label ?? filters.op;
  const activeFilterTags: ActiveAuditFilterTag[] = [];
  if (filters.query) {
    activeFilterTags.push({
      key: "query",
      label: "Search",
      value: filters.query,
      clear: { query: "" },
    });
  }
  if (filters.scope !== "all") {
    activeFilterTags.push({
      key: "scope",
      label: "Context",
      value: auditScopeLabel(filters.scope),
      clear: { scope: "all" },
    });
  }
  if (filters.op && opLabel) {
    activeFilterTags.push({
      key: "op",
      label: "Operation",
      value: opLabel,
      clear: { op: null },
    });
  }
  if (filters.actor && actorLabel) {
    activeFilterTags.push({
      key: "actor",
      label: "Performed by",
      value: actorLabel,
      clear: { actor: null },
    });
  }
  const hasActiveFilters = activeFilterTags.length > 0;
  const clearAllFilters = () => {
    navigate({ scope: "all", query: "", actor: null, op: null, page: 1 });
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <form className="min-w-0 flex-1 sm:flex-none" onSubmit={submitSearch}>
        <InputGroup className="h-9 w-full rounded-md border border-input bg-background shadow-xs sm:w-96 lg:w-[28rem]">
          <InputGroupAddon>
            <Search className="size-4 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, email, or activity…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            name="audit-search"
            aria-label="Search audit log by name, email, or activity"
            className="text-sm"
          />
        </InputGroup>
      </form>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-md border-input bg-background px-3 text-sm font-medium shadow-xs"
          >
            <ListFilter data-icon />
            Filters & sort
            {hasActiveFilters ? (
              <span className="ml-0.5 inline-flex size-5 items-center justify-center rounded-full bg-primary/20 text-[11px] font-semibold text-foreground">
                {activeFilterTags.length}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="max-h-[min(28rem,calc(100vh-8rem))] w-80 overflow-hidden rounded-lg p-0 shadow-lg"
        >
          <PopoverHeader className="flex-row items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
            <PopoverTitle className="text-sm font-semibold text-foreground">
              Filters & sort
            </PopoverTitle>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-7 rounded-full border border-rose-200 bg-rose-50 px-2.5 text-xs font-medium text-rose-700 hover:bg-rose-100 hover:text-rose-800 disabled:border-border disabled:bg-muted/40 disabled:text-muted-foreground"
              disabled={!hasActiveFilters}
              onClick={clearAllFilters}
            >
              Clear all
            </Button>
          </PopoverHeader>
          <div className="flex max-h-[calc(min(28rem,100vh-8rem)-3.75rem)] flex-col gap-4 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Chart context
              </span>
              <Select
                value={filters.scope}
                onValueChange={(value) => navigate({ scope: value as AuditScope })}
              >
                <SelectTrigger
                  className={cn(filterTriggerClass, "w-full justify-between")}
                >
                  <SelectValue placeholder="Chart context" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="sandbox">Sandbox</SelectItem>
                  <SelectItem value="all">All contexts</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Operation
              </span>
              <Select
                value={filters.op ?? "all"}
                onValueChange={(value) =>
                  navigate({ op: value === "all" ? null : value })
                }
              >
                <SelectTrigger
                  className={cn(filterTriggerClass, "w-full justify-between")}
                >
                  <SelectValue placeholder="Operation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All operations</SelectItem>
                  {ops.map((op) => (
                    <SelectItem key={op.op} value={op.op}>
                      {op.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Performed by
              </span>
              <Select
                value={filters.actor ?? "all"}
                onValueChange={(value) =>
                  navigate({ actor: value === "all" ? null : value })
                }
              >
                <SelectTrigger
                  className={cn(filterTriggerClass, "w-full justify-between")}
                >
                  <SelectValue placeholder="Performed by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  {actors.map((actor) => (
                    <SelectItem key={actor.authId} value={actor.authId}>
                      {actor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <span className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />

      {activeFilterTags.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {activeFilterTags.map((tag) => (
            <button
              key={tag.key}
              type="button"
              className="inline-flex max-w-64 items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => navigate(tag.clear)}
            >
              <span>{tag.label}:</span>
              <span className="truncate font-medium text-foreground/80">
                {tag.value}
              </span>
              <X className="size-3" aria-hidden="true" />
              <span className="sr-only">Clear {tag.label} filter</span>
            </button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-7 rounded-full border border-rose-200 bg-rose-50 px-2.5 text-xs font-medium text-rose-700 hover:bg-rose-100 hover:text-rose-800"
            onClick={clearAllFilters}
          >
            Clear all
          </Button>
        </div>
      ) : null}
    </div>
  );
}
function AuditPagination({
  filters,
  page,
  pageCount,
  onNavigate,
}: {
  filters: AuditFilters;
  page: number;
  pageCount: number;
  onNavigate: (patch: Partial<AuditFilters>) => void;
}) {
  return (
    <DataTablePagination
      page={page}
      pageCount={pageCount}
      onPageChange={(nextPage) => onNavigate({ page: nextPage })}
      getPageHref={(nextPage) =>
        auditUrl(filtersFromPatch(filters, { page: nextPage }))
      }
    />
  );
}

function AuditActorCell({
  name,
  email,
  avatarUrl,
}: {
  name: string;
  email: string | null;
  avatarUrl: string | null;
}) {
  return (
    <div className="flex min-w-[220px] max-w-full items-center gap-3 text-left">
      <Avatar className="size-8 shrink-0">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback>{personInitials(name)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 max-w-full">
        <span className="block font-medium leading-snug break-words text-gray-900">
          {name}
        </span>
        {email ? (
          <span className="mt-0.5 block text-sm leading-snug break-words text-gray-600 [overflow-wrap:anywhere]">
            {email}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function AuditTableLoadingStatus() {
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-30 inline-flex items-center gap-2 rounded-md border border-border/70 bg-background/95 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm">
      <Spinner className="size-3.5" />
      Updating results…
    </div>
  );
}

function AuditRow({ event }: { event: AuditEvent }) {
  const display = formatAuditEvent(event);
  const metadataText = JSON.stringify(display.metadata, null, 2);
  const hiddenCount = Math.max(0, Object.keys(display.metadata).length - 2);
  return (
    <TableRow className={cn(dataTableRowClass, "hover:bg-muted/30")}>
      <TableCell className={cellClass}>
        <span className="block text-sm tabular-nums text-muted-foreground">
          {formatAuditTime(event.createdAt)}
        </span>
      </TableCell>
      <TableCell className={cellClass}>
        <Badge
          variant="secondary"
          className="inline-block max-w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1 text-left text-xs font-medium leading-snug whitespace-normal text-gray-700"
        >
          {display.actionLabel}
        </Badge>
      </TableCell>
      <TableCell className={cn(cellClass, "min-w-[220px]")}>
        <AuditActorCell
          name={display.actorLabel}
          email={display.actorSubLabel}
          avatarUrl={event.actorAvatarUrl}
        />
      </TableCell>
      <TableCell className={cellClass}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            {display.preview.slice(0, 2).map((line) => (
              <p key={line.label} className="min-w-0 text-sm leading-relaxed">
                <span className="text-gray-600">{line.label}: </span>
                <span className="font-medium break-words text-gray-900">
                  {line.value}
                </span>
              </p>
            ))}
          </div>
          <div className="flex shrink-0 items-center">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200"
                  aria-label="View metadata"
                >
                  {hiddenCount > 0 ? <span>+{hiddenCount}</span> : null}
                  <Info className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">View metadata</span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[min(34rem,calc(100vw-2rem))] rounded-xl p-0"
              >
                <PopoverHeader className="border-b border-border/70 px-4 py-3">
                  <PopoverTitle className="text-sm font-semibold text-foreground/80">
                    Metadata
                  </PopoverTitle>
                </PopoverHeader>
                <pre className="max-h-[26rem] overflow-auto bg-muted/30 px-4 py-3 font-mono text-xs leading-5 text-foreground/70">
                  {metadataText}
                </pre>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

const EMPTY_DATA: AuditPageData = { rows: [], total: 0, page: 1, pageCount: 1 };

export function AuditLog({ initialFilters }: { initialFilters: AuditFilters }) {
  const [filters, setFilters] = useState(initialFilters);
  const [payload, setPayload] = useState<AuditPayload | null>(() => {
    const cached = getCachedAuditPayload(initialFilters);
    return cached?.payload ?? null;
  });
  const [loading, setLoading] = useState(() => !getCachedAuditPayload(initialFilters));
  const [failed, setFailed] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const cacheKey = auditCacheKey(filters);
  const data = payload?.data ?? { ...EMPTY_DATA, page: filters.page };
  const actors = payload?.actors ?? [];
  const ops = payload?.ops ?? [];
  const from = data.total === 0 ? 0 : (data.page - 1) * AUDIT_PAGE_SIZE + 1;
  const to = Math.min(data.page * AUDIT_PAGE_SIZE, data.total);
  const filtered =
    filters.query || filters.actor || filters.op || filters.scope !== "all";
  const emptyTitle = failed
    ? "Audit log failed to load"
    : filtered
      ? "No audit events match"
      : "No audit events yet";
  const emptyDescription = failed
    ? "Try refreshing the page."
    : filtered
      ? "Adjust the filters to broaden the audit log."
      : "Tracked user activity will appear here.";
  const countText = useMemo(
    () =>
      data.total === 0
        ? "0 events"
        : `Showing ${from}-${to} of ${data.total} ${data.total === 1 ? "event" : "events"}`,
    [data.total, from, to],
  );
  const entryCountText = useMemo(
    () =>
      `${data.total.toLocaleString("en-US")} ${data.total === 1 ? "entry" : "entries"}`,
    [data.total],
  );

  useEffect(() => {
    const onPopState = () => {
      setFilters(parseAuditFilters(new URLSearchParams(window.location.search)));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const cached = getCachedAuditPayload(filters);
    if (cached) {
      setPayload(cached.payload);
      setLoading(!cached.fresh);
      setFailed(false);
      if (cached.fresh) return;
    } else {
      setLoading(true);
      setFailed(false);
    }

    const controller = new AbortController();
    fetchAuditPayload(filters, controller.signal)
      .then((next) => {
        setPayload(rememberAuditPayload(next));
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [cacheKey, filters, refreshToken]);

  const navigate = useCallback(
    (patch: Partial<AuditFilters>) => {
      const next = filtersFromPatch(filters, patch);
      window.history.pushState(null, "", auditUrl(next));
      setFilters(next);
    },
    [filters],
  );

  const refresh = () => {
    clearAuditClientCache();
    setRefreshToken((current) => current + 1);
  };

  if (!payload && loading) {
    return <PageLoading label="Loading audit log…" />;
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden px-4 py-6">
      <div className="flex shrink-0 flex-col gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Audit Log
            </h1>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-6 text-muted-foreground hover:bg-transparent hover:text-foreground"
              aria-label="Refresh audit log"
              onClick={refresh}
            >
              <RefreshCw data-icon />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A complete record of all system actions and stage changes.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <AuditFiltersBar
            filters={filters}
            actors={actors}
            ops={ops}
            onNavigate={navigate}
          />
          <p className="ml-auto text-sm text-muted-foreground">{entryCountText}</p>
        </div>
      </div>

      <DataTableShell
        empty={
          data.rows.length === 0 ? (
            <Empty className="flex-none border-0">
              <EmptyHeader>
                <EmptyTitle>{emptyTitle}</EmptyTitle>
                <EmptyDescription>{emptyDescription}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : undefined
        }
        footer={
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{countText}</p>
            <AuditPagination
              filters={filters}
              page={data.page}
              pageCount={data.pageCount}
              onNavigate={navigate}
            />
          </div>
        }
      >
        {payload && loading ? <AuditTableLoadingStatus /> : null}
        <Table
          containerClassName="overflow-visible"
          className={cn(
            "min-w-[70rem] table-fixed transition-opacity",
            payload && loading && "opacity-70",
          )}
          aria-busy={loading}
        >
          <colgroup>
            {COLUMNS.map((col) => (
              <col key={col.label} className={col.className} />
            ))}
          </colgroup>
          <TableHeader className="[&_tr]:border-b-0">
            <TableRow className="border-b-0 hover:bg-transparent">
              {COLUMNS.map((col) => (
                <TableHead key={col.label} className={headClass}>
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className={dataTableBodyClass}>
            {data.rows.map((event) => (
              <AuditRow key={event.id} event={event} />
            ))}
          </TableBody>
        </Table>
      </DataTableShell>
    </div>
  );
}
