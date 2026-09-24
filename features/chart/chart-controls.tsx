"use client";

import { Minus, Plus, Scan } from "lucide-react";

import { Button } from "@/components/ui/button";

export function ChartControls({
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-background/95 p-1 shadow-sm">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onZoomIn}
        aria-label="Zoom in"
      >
        <Plus />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onZoomOut}
        aria-label="Zoom out"
      >
        <Minus />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onFit}
        aria-label="Fit visible"
      >
        <Scan />
      </Button>
    </div>
  );
}
