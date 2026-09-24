"use client";

import { useEffect, useMemo, useState } from "react";

import type { ChartRow } from "@/features/chart/chart-row";
import { useCanSeeDirectoryStatus } from "@/features/auth/auth-provider";
import { useOrgData } from "@/store/org-data";
import {
  buildDirectoryRows,
  hydratePublicDirectoryRows,
  type DirectoryRow,
} from "./directory-row";
import { DirectoryClient } from "./directory-client";
import type { HeaderOption } from "./filter-bar";
import { buildHeaderOptions } from "./header-options";
import type { DirectoryStreamMessage } from "./directory-stream";

interface DirectoryRouteState {
  treeId: string | null;
  versionSeq: number | null;
  publishedAt: string | null;
  rows: DirectoryRow[];
  headers: HeaderOption[];
  chartRows: ChartRow[];
  total: number | null;
  loading: boolean;
  complete: boolean;
  error: string | null;
}

const INITIAL_STATE: DirectoryRouteState = {
  treeId: null,
  versionSeq: null,
  publishedAt: null,
  rows: [],
  headers: [],
  chartRows: [],
  total: null,
  loading: true,
  complete: false,
  error: null,
};

export function DirectoryRouteClient() {
  const cachedTreeId = useOrgData((state) => state.treeId);
  const cachedTreeKind = useOrgData((state) => state.treeKind);
  const cachedVersionSeq = useOrgData((state) => state.versionSeq);
  const cachedPublishedAt = useOrgData((state) => state.publishedAt);
  const cachedChartRows = useOrgData((state) => state.chartRows);
  const showStatus = useCanSeeDirectoryStatus();

  const cached = useMemo(() => {
    if (showStatus) return null;
    if (
      cachedTreeKind !== "published" ||
      cachedChartRows.length === 0 ||
      !cachedTreeId
    ) {
      return null;
    }
    const rows = buildDirectoryRows(cachedChartRows);
    return {
      treeId: cachedTreeId,
      versionSeq: cachedVersionSeq,
      publishedAt: cachedPublishedAt,
      rows,
      headers: buildHeaderOptions(cachedChartRows),
      chartRows: cachedChartRows,
      total: rows.length,
      loading: false,
      complete: true,
      error: null,
    };
  }, [
    cachedTreeId,
    cachedTreeKind,
    cachedVersionSeq,
    cachedPublishedAt,
    cachedChartRows,
    showStatus,
  ]);

  const [state, setState] = useState<DirectoryRouteState>(
    () => cached ?? INITIAL_STATE,
  );

  useEffect(() => {
    if (cached) {
      setState(cached);
      return;
    }

    const abort = new AbortController();
    setState(INITIAL_STATE);

    async function load() {
      try {
        const response = await fetch("/api/directory/published", {
          headers: { Accept: "application/x-ndjson" },
          signal: abort.signal,
        });
        if (!response.ok)
          throw new Error(`Directory request failed (${response.status})`);
        if (!response.body)
          throw new Error("Directory response did not include a body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            const message = JSON.parse(line) as DirectoryStreamMessage;
            if (message.type === "meta") {
              setState((current) => ({
                ...current,
                treeId: message.treeId,
                versionSeq: message.versionSeq,
                publishedAt: message.publishedAt,
                headers: message.headers,
                total: message.total,
                loading: true,
                complete: false,
                error: null,
              }));
            } else if (message.type === "rows") {
              setState((current) => ({
                ...current,
                rows: [...current.rows, ...hydratePublicDirectoryRows(message.rows)],
              }));
            } else {
              setState((current) => ({
                ...current,
                loading: false,
                complete: true,
              }));
            }
          }

          if (done) break;
        }
      } catch {
        if (abort.signal.aborted) return;
        setState((current) => ({
          ...current,
          loading: false,
          complete: false,
          error: "Directory failed to load",
        }));
      }
    }

    void load();
    return () => abort.abort();
  }, [cached]);

  return (
    <DirectoryClient
      treeId={state.treeId}
      versionSeq={state.versionSeq}
      publishedAt={state.publishedAt}
      directoryRows={state.rows}
      headers={state.headers}
      chartRows={state.chartRows}
      totalRows={state.total}
      isLoading={state.loading}
      isComplete={state.complete}
      error={state.error}
    />
  );
}
