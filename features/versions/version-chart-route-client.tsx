"use client";

import { useEffect, useMemo, useState } from "react";

import { ChartClient } from "@/features/chart/chart-client";
import {
  hydratePublicChartRows,
  type ChartRow,
  type PublicChartRow,
} from "@/features/chart/chart-row";
import { useOrgData } from "@/store/org-data";

interface VersionChartRouteState {
  treeId: string | null;
  treeKind: "published" | "historical" | null;
  versionSeq: number | null;
  rows: ChartRow[];
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: VersionChartRouteState = {
  treeId: null,
  treeKind: null,
  versionSeq: null,
  rows: [],
  loading: true,
  error: null,
};

function VersionLoading({ error }: { error?: string | null }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">{error ?? "Loading version…"}</p>
    </div>
  );
}

export function VersionChartRouteClient({
  treeId,
  initialFocus = null,
}: {
  treeId: string;
  initialFocus?: string | null;
}) {
  const cachedTreeId = useOrgData((state) => state.treeId);
  const cachedTreeKind = useOrgData((state) => state.treeKind);
  const cachedVersionSeq = useOrgData((state) => state.versionSeq);
  const cachedChartRows = useOrgData((state) => state.chartRows);

  const cached = useMemo(() => {
    if (
      cachedTreeId !== treeId ||
      (cachedTreeKind !== "published" && cachedTreeKind !== "historical") ||
      cachedChartRows.length === 0
    ) {
      return null;
    }
    return {
      treeId: cachedTreeId,
      treeKind: cachedTreeKind,
      versionSeq: cachedVersionSeq,
      rows: cachedChartRows,
      loading: false,
      error: null,
    };
  }, [treeId, cachedTreeId, cachedTreeKind, cachedVersionSeq, cachedChartRows]);

  const [state, setState] = useState<VersionChartRouteState>(
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
        const response = await fetch(
          `/api/versions/${encodeURIComponent(treeId)}/chart`,
          {
            headers: { Accept: "application/json" },
            signal: abort.signal,
          },
        );
        if (!response.ok)
          throw new Error(`Version request failed (${response.status})`);
        const snapshot = (await response.json()) as {
          treeId: string;
          treeKind: "published" | "historical";
          versionSeq: number | null;
          rows: PublicChartRow[];
        };
        setState({
          treeId: snapshot.treeId,
          treeKind: snapshot.treeKind,
          versionSeq: snapshot.versionSeq,
          rows: hydratePublicChartRows(snapshot.rows),
          loading: false,
          error: null,
        });
      } catch {
        if (abort.signal.aborted) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: "Version failed to load",
        }));
      }
    }

    void load();
    return () => abort.abort();
  }, [cached, treeId]);

  if (state.loading || state.error || !state.treeId || !state.treeKind) {
    return <VersionLoading error={state.error} />;
  }

  return (
    <ChartClient
      treeId={state.treeId}
      treeKind={state.treeKind}
      versionSeq={state.versionSeq}
      sandboxName={null}
      rows={state.rows}
      editable={false}
      initialFocus={initialFocus}
    />
  );
}
