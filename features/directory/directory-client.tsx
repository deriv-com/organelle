"use client";

/**
 * Directory page client container. Owns filter, sort, and page
 * state; the employee dialog is store-driven and mounted globally in the root layout.
 */

import { useEffect, useMemo, useState } from "react";

import { useCanSeeDirectoryStatus } from "@/features/auth/auth-provider";
import { useOrgData } from "@/store/org-data";
import { DirectoryTable, PAGE_SIZE } from "./directory-table";
import type { ChartRow } from "@/features/chart/chart-row";
import { FilterBar, type HeaderOption } from "./filter-bar";
import {
  applyFilters,
  EMPTY_FILTERS,
  officeOptions,
  sortRows,
  type DirectoryFilters,
  type SortKey,
} from "./filter";
import type { DirectoryRow } from "./directory-row";

export interface DirectoryClientProps {
  treeId: string | null;
  versionSeq: number | null;
  publishedAt: string | null;
  directoryRows: DirectoryRow[];
  headers: HeaderOption[];
  totalRows: number | null;
  isLoading: boolean;
  isComplete: boolean;
  error: string | null;
  chartRows?: ChartRow[];
}

export function DirectoryClient({
  treeId,
  versionSeq,
  publishedAt,
  directoryRows,
  headers,
  totalRows,
  isLoading,
  isComplete,
  error,
  chartRows = [],
}: DirectoryClientProps) {
  const setData = useOrgData((state) => state.setData);
  const setDrawerAuthId = useOrgData((state) => state.setDrawerAuthId);
  const showStatus = useCanSeeDirectoryStatus();

  const [filters, setFilters] = useState<DirectoryFilters>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!treeId) return;
    setData({
      treeId,
      treeKind: "published",
      versionSeq,
      sandboxName: null,
      publishedAt,
      chartRows,
      directoryRows,
    });
  }, [treeId, versionSeq, publishedAt, chartRows, directoryRows, setData]);

  // Filters/sort change the result set — back to page 1.
  useEffect(() => {
    setPage(1);
  }, [filters, sortKey, sortDir]);

  const openEmployee = (authId: string, nodeId: string) =>
    setDrawerAuthId(authId, nodeId);

  const offices = useMemo(() => officeOptions(directoryRows), [directoryRows]);
  const rows = useMemo(() => {
    const active = showStatus ? filters : { ...filters, statuses: [] };
    return sortRows(applyFilters(directoryRows, active), sortKey, sortDir);
  }, [directoryRows, filters, showStatus, sortKey, sortDir]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const pageRows = rows.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  return (
    <div className="flex h-full min-h-0 flex-col px-4">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        headers={headers}
        offices={offices}
        showStatus={showStatus}
      />
      <DirectoryTable
        rows={pageRows}
        total={rows.length}
        totalRows={totalRows}
        page={clampedPage}
        pageCount={pageCount}
        isLoading={isLoading}
        isComplete={isComplete}
        error={error}
        onPageChange={setPage}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(key) => {
          if (key === sortKey) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
          else {
            setSortKey(key);
            setSortDir("asc");
          }
        }}
        onOpenEmployee={openEmployee}
        showStatus={showStatus}
      />
    </div>
  );
}
