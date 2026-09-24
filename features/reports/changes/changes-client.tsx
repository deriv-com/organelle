"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChangesDatePicker,
  changesFilterTriggerClass,
  defaultChangesDate,
  DownloadChangesButton,
} from "./download-changes";
import { ChangesTable, DiffLine } from "./changes-table";
import type { ChangeType } from "./labels";
import type { SeatSnapshot } from "./seat-snapshot";

interface ApiRow {
  nodeId: string;
  changeType: ChangeType;
  changeTypeLabel: string;
  before: SeatSnapshot | null;
  after: SeatSnapshot | null;
  actorName: string;
  position: string;
  effectiveDate: string;
}

interface ApiPayload {
  date: string;
  empty: boolean;
  rows: ApiRow[];
  headerRenames: Array<{ nodeId: string; beforeName: string; afterName: string }>;
}

export function ChangesClient() {
  const searchParams = useSearchParams();
  const initialDate = searchParams.get("date") ?? defaultChangesDate();
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/changes?date=${encodeURIComponent(d)}`);
      if (!res.ok) {
        setData(null);
        return;
      }
      setData((await res.json()) as ApiPayload);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  const departments = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const row of data.rows) {
      const dept = row.after?.dept ?? row.before?.dept;
      if (dept) set.add(dept);
    }
    return [...set].sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((row) => {
      const dept = row.after?.dept ?? row.before?.dept ?? "";
      if (deptFilter !== "all" && dept !== deptFilter) return false;
      if (typeFilter !== "all" && row.changeType !== typeFilter) return false;
      return true;
    });
  }, [data, deptFilter, typeFilter]);

  const types = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.rows.map((r) => r.changeType))].sort();
  }, [data]);

  const emptyDay = !loading && (!data || data.empty);
  const filteredEmpty =
    !loading && data !== null && !data.empty && filtered.length === 0;

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold text-foreground/80">Daily changes</h1>
          <p className="text-xs text-muted-foreground">
            Published chart diffs by KL calendar day
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ChangesDatePicker date={date} onDateChange={setDate} />
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className={cn(changesFilterTriggerClass, "w-[10rem]")}>
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className={cn(changesFilterTriggerClass, "w-[10rem]")}>
              <SelectValue placeholder="Change type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {types.map((t) => (
                <SelectItem key={t} value={t}>
                  {data?.rows.find((r) => r.changeType === t)?.changeTypeLabel ?? t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DownloadChangesButton date={date} />
        </div>
      </div>

      <ChangesTable
        rows={filtered}
        loading={loading}
        emptyDay={emptyDay}
        filteredEmpty={filteredEmpty}
      />

      {data && data.headerRenames.length > 0 ? (
        <section className="shrink-0 rounded-lg bg-muted p-1">
          <div className="rounded-md bg-background p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground/80">Header changes</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Renames are listed separately to avoid reporting every descendant as
              moved.
            </p>
            <ul className="space-y-1 text-sm text-foreground/70">
              {data.headerRenames.map((h) => (
                <li key={h.nodeId}>
                  <DiffLine before={h.beforeName} after={h.afterName} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}
