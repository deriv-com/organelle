"use client";

import { useEffect, useMemo, useState } from "react";

import { useOrgData } from "@/store/org-data";
import { ChartClient } from "./chart-client";
import {
  hydratePublicChartRows,
  type ChartRow,
  type PublicChartRow,
} from "./chart-row";

interface ChartRouteState {
  treeId: string | null;
  versionSeq: number | null;
  publishedAt: string | null;
  rows: ChartRow[];
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: ChartRouteState = {
  treeId: null,
  versionSeq: null,
  publishedAt: null,
  rows: [],
  loading: true,
  error: null,
};

function ChartLoading({ error }: { error?: string | null }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">{error ?? "Loading chart…"}</p>
    </div>
  );
}

export function ChartRouteClient({
  initialFocus = null,
}: {
  initialFocus?: string | null;
}) {
  const cachedTreeId = useOrgData((state) => state.treeId);
  const cachedTreeKind = useOrgData((state) => state.treeKind);
  const cachedVersionSeq = useOrgData((state) => state.versionSeq);
  const cachedPublishedAt = useOrgData((state) => state.publishedAt);
  const cachedChartRows = useOrgData((state) => state.chartRows);

  const cached = useMemo(() => {
    if (
      cachedTreeKind !== "published" ||
      cachedChartRows.length === 0 ||
      !cachedTreeId
    ) {
      return null;
    }
    return {
      treeId: cachedTreeId,
      versionSeq: cachedVersionSeq,
      publishedAt: cachedPublishedAt,
      rows: cachedChartRows,
      loading: false,
      error: null,
    };
  }, [
    cachedTreeId,
    cachedTreeKind,
    cachedVersionSeq,
    cachedPublishedAt,
    cachedChartRows,
  ]);

  const [state, setState] = useState<ChartRouteState>(() => cached ?? INITIAL_STATE);

  useEffect(() => {
    if (cached) {
      setState(cached);
      return;
    }

    const abort = new AbortController();
    setState(INITIAL_STATE);

    async function load() {
      try {
        const response = await fetch("/api/chart/published", {
          headers: { Accept: "application/json" },
          signal: abort.signal,
        });
        if (!response.ok) throw new Error(`Chart request failed (${response.status})`);
        const snapshot = (await response.json()) as {
          treeId: string;
          versionSeq: number;
          publishedAt: string | null;
          rows: PublicChartRow[];
        };
        setState({
          treeId: snapshot.treeId,
          versionSeq: snapshot.versionSeq,
          publishedAt: snapshot.publishedAt,
          rows: hydratePublicChartRows(snapshot.rows),
          loading: false,
          error: null,
        });
      } catch {
        if (abort.signal.aborted) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: "Chart failed to load",
        }));
      }
    }

    void load();
    return () => abort.abort();
  }, [cached]);

  if (state.loading || state.error || !state.treeId) {
    return <ChartLoading error={state.error} />;
  }

  return (
    <ChartClient
      treeId={state.treeId}
      treeKind="published"
      versionSeq={state.versionSeq}
      sandboxName={null}
      publishedAt={state.publishedAt}
      rows={state.rows}
      editable={false}
      initialFocus={initialFocus}
    />
  );
}
