"use client";

/**
 * Paginated directory table. One row per seat.
 */

import { ArrowDown, ArrowUp, ArrowUpDown, Users } from "lucide-react";

import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { DataTableShell } from "@/components/data-table/data-table-shell";
import { PersonCell } from "@/components/data-table/person-cell";
import {
  dataTableBodyClass,
  dataTableCellPad,
  dataTableHeadClass,
  dataTableRowClass,
} from "@/components/data-table/styles";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatJoining } from "@/features/chart/card";
import type { SeatMember } from "@/features/chart/chart-row";
import { cn } from "@/lib/utils";
import type { DirectoryRow } from "./directory-row";
import { EMPLOYEE_STATUS_LABELS } from "./employee-fields";
import type { SortKey } from "./filter";

export const PAGE_SIZE = 25;

const COLUMNS: Array<{ key: SortKey | null; label: string }> = [
  { key: "name", label: "Name" },
  { key: null, label: "Status" },
  { key: "teamPath", label: "Team" },
  { key: null, label: "Reports to" },
  { key: "location", label: "Location" },
  { key: null, label: "Peers" },
];

function statusBadge(member: SeatMember) {
  if (member.status === "joining") {
    return (
      <Badge variant="outline">
        {member.joiningDate ? formatJoining(member.joiningDate) : "Joining"}
      </Badge>
    );
  }
  if (member.status === "active") {
    return <Badge variant="default">Active</Badge>;
  }
  if (member.status === "resigned") {
    return <Badge variant="destructive">Resigned</Badge>;
  }
  return <Badge variant="secondary">{EMPLOYEE_STATUS_LABELS[member.status]}</Badge>;
}

export interface DirectoryTableProps {
  rows: DirectoryRow[];
  total: number;
  totalRows: number | null;
  page: number;
  pageCount: number;
  isLoading: boolean;
  isComplete: boolean;
  error: string | null;
  onPageChange: (page: number) => void;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  onOpenEmployee: (authId: string, nodeId: string) => void;
  showStatus?: boolean;
}

export function DirectoryTable({
  rows,
  total,
  totalRows,
  page,
  pageCount,
  isLoading,
  isComplete,
  error,
  onPageChange,
  sortKey,
  sortDir,
  onSort,
  onOpenEmployee,
  showStatus = true,
}: DirectoryTableProps) {
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const countText = isLoading
    ? `${total} loaded ${total === 1 ? "seat" : "seats"}${
        totalRows !== null ? ` of ${totalRows}` : ""
      }`
    : `Showing ${from}-${to} of ${total}`;

  return (
    <DataTableShell
      className="pb-4"
      empty={
        rows.length === 0 ? (
          <Empty className="flex-none border-0">
            <EmptyHeader>
              <EmptyTitle>
                {error
                  ? "Directory failed to load"
                  : isLoading
                    ? "Directory is loading"
                    : "No seats match"}
              </EmptyTitle>
              <EmptyDescription>
                {error
                  ? "Try refreshing the page."
                  : isLoading
                    ? "Rows will appear as they arrive."
                    : "Adjust filters to see people."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : undefined
      }
      footer={
        <div className="flex shrink-0 items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            {countText}
            {!isLoading && !isComplete ? " loaded" : ""}
          </span>
          <DataTablePagination
            page={page}
            pageCount={pageCount}
            onPageChange={onPageChange}
            hideWhenSinglePage={false}
          />
        </div>
      }
    >
      <Table containerClassName="overflow-visible">
        <TableHeader className="sticky top-0 z-10 bg-muted [&_tr]:border-b-0">
          <TableRow className="border-b-0 hover:bg-transparent">
            {COLUMNS.filter((column) => showStatus || column.label !== "Status").map(
              (column) => (
                <TableHead
                  key={column.label}
                  className={cn(dataTableHeadClass, dataTableCellPad)}
                >
                  {column.key ? (
                    <button
                      type="button"
                      onClick={() => onSort(column.key!)}
                      className="inline-flex items-center gap-1 font-semibold outline-none"
                    >
                      {column.label}
                      {sortKey === column.key ? (
                        sortDir === "asc" ? (
                          <ArrowUp className="size-3.5" />
                        ) : (
                          <ArrowDown className="size-3.5" />
                        )
                      ) : (
                        <ArrowUpDown className="size-3.5 opacity-40" />
                      )}
                    </button>
                  ) : (
                    column.label
                  )}
                </TableHead>
              ),
            )}
          </TableRow>
        </TableHeader>
        <TableBody className={dataTableBodyClass}>
          {rows.map((row) => {
            const { host } = row;
            return (
              <TableRow
                key={row.nodeId || row.host.authId}
                className={cn("cursor-pointer", dataTableRowClass)}
                onClick={() => onOpenEmployee(host.authId, row.nodeId)}
              >
                <TableCell className={dataTableCellPad}>
                  <PersonCell
                    name={host.displayName}
                    email={host.email}
                    avatarUrl={host.avatarUrl}
                    onClick={() => onOpenEmployee(host.authId, row.nodeId)}
                  />
                </TableCell>
                {showStatus ? (
                  <TableCell className={dataTableCellPad}>
                    {statusBadge(host)}
                  </TableCell>
                ) : null}
                <TableCell className={cn(dataTableCellPad, "max-w-64 truncate")}>
                  {row.teamPath}
                </TableCell>
                <TableCell className={cn(dataTableCellPad, "max-w-48 truncate")}>
                  {row.manager}
                </TableCell>
                <TableCell className={cn(dataTableCellPad, "truncate")}>
                  {host.officeLocation}
                </TableCell>
                <TableCell className={dataTableCellPad}>
                  {row.peers > 1 ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Users className="size-4" />
                      {row.peers}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </DataTableShell>
  );
}
