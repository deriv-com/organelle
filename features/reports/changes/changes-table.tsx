"use client";

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
import { DataTableShell } from "@/components/data-table/data-table-shell";
import { PersonCell } from "@/components/data-table/person-cell";
import {
  dataTableBodyClass,
  dataTableCellPad,
  dataTableHeadClass,
  dataTableRowClass,
} from "@/components/data-table/styles";
import { cn } from "@/lib/utils";

import type { ChangeType } from "./labels";
import type { SeatSnapshot } from "./seat-snapshot";

export interface ChangesTableRow {
  nodeId: string;
  changeType: ChangeType;
  changeTypeLabel: string;
  before: SeatSnapshot | null;
  after: SeatSnapshot | null;
  actorName: string;
  position: string;
  effectiveDate: string;
}

/** Override shadcn TableCell defaults (whitespace-nowrap) for wrapped report rows. */
const cellClass = cn(dataTableCellPad, "whitespace-normal align-top break-words");

const headClass = cn(
  dataTableHeadClass,
  dataTableCellPad,
  "sticky top-0 z-20 whitespace-normal bg-muted shadow-[0_1px_0_0_rgba(0,0,0,0.06)]",
);

function pathLabel(s: SeatSnapshot | null): string {
  if (!s) return "—";
  return [s.dept, ...s.teamLevels].filter(Boolean).join(" › ") || "—";
}

/** One-line summary for the in-app table only (CSV unchanged). */
export function formatChangeSentence(row: ChangesTableRow): string {
  const { before, after, changeType } = row;

  if (changeType === "new_hire" && after) {
    const where = pathLabel(after);
    const manager = after.managerName;
    if (manager && where !== "—") {
      return `Joined under ${manager} in ${where}.`;
    }
    if (manager) return `Joined reporting to ${manager}.`;
    if (where !== "—") return `Joined in ${where}.`;
    return "Joined the chart.";
  }

  if (changeType === "seat_removed" && before) {
    const where = pathLabel(before);
    if (where !== "—") return `Removed from ${where}.`;
    return "Removed from the chart.";
  }

  const clauses: string[] = [];
  const mgrBefore = before?.managerName ?? "";
  const mgrAfter = after?.managerName ?? "";
  if (mgrBefore !== mgrAfter) {
    clauses.push(`manager changed from ${mgrBefore || "—"} to ${mgrAfter || "—"}`);
  }

  const pathBefore = pathLabel(before);
  const pathAfter = pathLabel(after);
  if (pathBefore !== pathAfter) {
    clauses.push(`team changed from ${pathBefore} to ${pathAfter}`);
  }

  const peersBefore = before?.memberAuthIds.join(",") ?? "";
  const peersAfter = after?.memberAuthIds.join(",") ?? "";
  if (
    peersBefore !== peersAfter &&
    pathBefore === pathAfter &&
    mgrBefore === mgrAfter
  ) {
    clauses.push("peers on this seat changed");
  }

  if (clauses.length === 0) {
    return row.changeTypeLabel + ".";
  }

  const sentence = clauses.join(" and ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}

function DiffLine({ before, after }: { before: string; after: string }) {
  if (before === after) {
    return <span className="break-words">{after || "—"}</span>;
  }
  return (
    <span className="block min-w-0 break-words leading-relaxed">
      <span className="text-muted-foreground line-through">{before || "—"}</span>
      <span className="px-1 text-muted-foreground">→</span>
      <span className="font-medium text-foreground">{after || "—"}</span>
    </span>
  );
}

const COLUMNS = [
  { label: "Employee", className: "w-[14rem]" },
  { label: "Position", className: "w-[14rem]" },
  { label: "Change", className: "w-[9rem]" },
  { label: "Summary", className: "min-w-[18rem]" },
  { label: "Actor", className: "w-[8rem]" },
] as const;

export interface ChangesTableProps {
  rows: ChangesTableRow[];
  loading: boolean;
  emptyDay: boolean;
  filteredEmpty?: boolean;
}

export function ChangesTable({
  rows,
  loading,
  emptyDay,
  filteredEmpty = false,
}: ChangesTableProps) {
  const showEmpty = loading || emptyDay || rows.length === 0;

  const emptyTitle = loading
    ? "Loading changes"
    : emptyDay
      ? "No changes this day"
      : filteredEmpty
        ? "No changes match filters"
        : "No changes this day";

  const emptyDescription = loading
    ? "Fetching published diffs for this date."
    : emptyDay
      ? "Pick another date or publish a merge to generate a report."
      : filteredEmpty
        ? "Adjust department or change-type filters."
        : "Pick another date or publish a merge to generate a report.";

  return (
    <DataTableShell
      empty={
        showEmpty ? (
          <Empty className="flex-none border-0">
            <EmptyHeader>
              <EmptyTitle>{emptyTitle}</EmptyTitle>
              <EmptyDescription>{emptyDescription}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : undefined
      }
      footer={
        !loading && rows.length > 0 ? (
          <p className="shrink-0 text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? "change" : "changes"}
          </p>
        ) : null
      }
    >
      <Table
        containerClassName="overflow-visible"
        className="min-w-[56rem] table-fixed"
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
          {!loading &&
            rows.map((row) => {
              const name = row.after?.fullName ?? row.before?.fullName ?? "Unknown";
              const email = row.after?.email ?? row.before?.email ?? "";
              return (
                <TableRow key={row.nodeId} className={dataTableRowClass}>
                  <TableCell className={cellClass}>
                    <PersonCell name={name} email={email} />
                  </TableCell>
                  <TableCell className={cellClass}>
                    <span className="block break-words leading-relaxed">
                      {row.position}
                    </span>
                  </TableCell>
                  <TableCell className={cellClass}>
                    <Badge
                      variant="secondary"
                      className="inline-block max-w-full whitespace-normal text-left leading-snug"
                    >
                      {row.changeTypeLabel}
                    </Badge>
                  </TableCell>
                  <TableCell className={cellClass}>
                    <p className="text-sm leading-relaxed text-foreground/80">
                      {formatChangeSentence(row)}
                    </p>
                  </TableCell>
                  <TableCell className={cellClass}>
                    <span className="block break-words">{row.actorName}</span>
                  </TableCell>
                </TableRow>
              );
            })}
        </TableBody>
      </Table>
    </DataTableShell>
  );
}

export { DiffLine };
