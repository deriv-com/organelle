"use client";

import { useMemo, useState } from "react";
import { CalendarIcon, Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { organizationDateString } from "@/features/reports/csv";
import { cn } from "@/lib/utils";

/** Shared white filter control styling on the changes toolbar. */
export const changesFilterTriggerClass =
  "h-9 rounded-md border border-input bg-background text-sm shadow-xs";

function parseYmd(ymd: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return undefined;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

function formatYmdSlash(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return ymd;
  const [, y, m, d] = match;
  return `${d}/${m}/${y}`;
}

export function ChangesDatePicker({
  date,
  onDateChange,
}: {
  date: string;
  onDateChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => parseYmd(date), [date]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label="Changes report date"
          className={cn(
            changesFilterTriggerClass,
            "w-[10.5rem] justify-start gap-2 px-3 font-normal",
          )}
        >
          <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
          {formatYmdSlash(date)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(day) => {
            if (!day) return;
            onDateChange(organizationDateString(day));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export async function downloadChangesCsv(date: string): Promise<void> {
  const res = await fetch(`/api/export/changes?date=${encodeURIComponent(date)}`);
  if (!res.ok) {
    toast.error("Download failed");
    return;
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? `organelle_changes_${date}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function DownloadChangesButton({
  date,
  size = "sm",
  variant = "outline",
  label = "Download changes",
}: {
  date: string;
  size?: "sm" | "default" | "icon-sm";
  variant?: "outline" | "default" | "ghost";
  label?: string;
}) {
  return (
    <Button variant={variant} size={size} onClick={() => void downloadChangesCsv(date)}>
      <Download data-icon="inline-start" />
      {label}
    </Button>
  );
}

export function defaultChangesDate(): string {
  return organizationDateString();
}

export function publishedAtToKlDate(iso: string | null): string {
  if (!iso) return organizationDateString();
  return organizationDateString(new Date(iso));
}
