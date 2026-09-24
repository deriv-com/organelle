"use client";

import Link from "next/link";
import { useState } from "react";

import {
  ChangesDatePicker,
  defaultChangesDate,
  DownloadChangesButton,
} from "@/features/reports/changes/download-changes";
import { useCanExport } from "@/features/auth/auth-provider";
import { Button } from "@/components/ui/button";

export function VersionsHeaderActions() {
  const canExport = useCanExport();
  const [date, setDate] = useState(defaultChangesDate);

  if (!canExport) return null;

  return (
    <div className="flex items-center justify-end gap-2">
      <ChangesDatePicker date={date} onDateChange={setDate} />
      <DownloadChangesButton date={date} size="sm" />
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/changes?date=${encodeURIComponent(date)}`}>
          View changes table
        </Link>
      </Button>
    </div>
  );
}
