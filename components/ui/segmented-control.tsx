"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export function SegmentedTrack({
  className,
  fullWidth,
  ...props
}: React.ComponentProps<"div"> & { fullWidth?: boolean }) {
  return (
    <div
      data-slot="segmented-track"
      className={cn(
        "inline-flex h-9 min-w-0 items-center rounded-lg bg-muted p-1",
        fullWidth && "flex w-full",
        className,
      )}
      {...props}
    />
  );
}

export function segmentedItemClass(active: boolean, className?: string) {
  return cn(
    "rounded-md px-3 py-1 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 cursor-pointer",
    active && "bg-background text-foreground shadow-sm hover:text-foreground",
    className,
  );
}

export function SegmentedItem({
  active,
  fullWidth,
  className,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean; fullWidth?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        segmentedItemClass(Boolean(active), fullWidth ? "flex-1" : undefined),
        className,
      )}
      {...props}
    />
  );
}
