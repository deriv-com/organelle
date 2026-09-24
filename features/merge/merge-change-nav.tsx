"use client";

import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import type { MergeResult } from "./types";

export type MergeChangeNavKind = "added" | "removed" | "moved" | "edited";

export type MergeChangeNavItem = {
  id: string;
  nodeId: string;
  kind: MergeChangeNavKind;
  label: string;
  changeKey?: string;
  fieldChanges?: NonNullable<MergeResult["changes"][number]["fieldChanges"]>;
  employee?: NonNullable<MergeResult["changes"][number]["employee"]>;
};

const KIND_ORDER: Record<MergeChangeNavKind, number> = {
  removed: 0,
  moved: 1,
  edited: 2,
  added: 3,
};

const KIND_LABEL: Record<MergeChangeNavKind, string> = {
  added: "Added",
  removed: "Removed",
  moved: "Moved",
  edited: "Edited",
};

const KIND_DOT: Record<MergeChangeNavKind, string> = {
  added: "bg-green-500",
  removed: "bg-red-500",
  moved: "bg-amber-400",
  edited: "bg-amber-400",
};

export function buildMergeChangeNavItems(
  tints: MergeResult["tints"],
  labelFor: (nodeId: string) => string,
  changes: MergeResult["changes"] = [],
): MergeChangeNavItem[] {
  const kindForChange = (
    change: MergeResult["changes"][number],
  ): MergeChangeNavKind => {
    if (change.kind === "create") return "added";
    if (change.kind === "delete") return "removed";
    if (change.kind === "move") return "moved";
    return "edited";
  };
  const items: MergeChangeNavItem[] = changes.map((change) => ({
    id: change.key,
    nodeId: change.nodeId,
    kind: kindForChange(change),
    label: change.summary,
    changeKey: change.key,
    fieldChanges: change.fieldChanges,
    employee: change.employee,
  }));

  const addVisualFallback = (kind: MergeChangeNavKind, nodeId: string) => {
    if (items.some((item) => item.nodeId === nodeId && item.kind === kind)) return;
    items.push({
      id: `${kind}:${nodeId}`,
      nodeId,
      kind,
      label: labelFor(nodeId),
    });
  };

  for (const nodeId of tints.removed) addVisualFallback("removed", nodeId);
  for (const nodeId of tints.moved) addVisualFallback("moved", nodeId);
  for (const nodeId of tints.edited) addVisualFallback("edited", nodeId);
  for (const nodeId of tints.added) addVisualFallback("added", nodeId);

  return items.sort((a, b) => {
    const order = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return order !== 0 ? order : a.label.localeCompare(b.label);
  });
}

export function changeNavKindLabel(kind: MergeChangeNavKind): string {
  return KIND_LABEL[kind];
}

export function changeNavKindDot(kind: MergeChangeNavKind): string {
  return KIND_DOT[kind];
}

/** Auto-change include key when this diff is selectively mergeable; null if conflict-only. */
export function includeKeyForNavItem(
  item: MergeChangeNavItem,
  changes: MergeResult["changes"],
): string | null {
  if (item.changeKey?.startsWith("employee:")) return null;
  if (item.changeKey && changes.some((change) => change.key === item.changeKey)) {
    return item.changeKey;
  }
  if (item.kind === "added") {
    const key = `create:${item.nodeId}`;
    return changes.some((c) => c.key === key) ? key : null;
  }
  if (item.kind === "removed") {
    const key = `delete:${item.nodeId}`;
    return changes.some((c) => c.key === key) ? key : null;
  }
  if (item.kind === "moved") {
    const key = `move:${item.nodeId}`;
    return changes.some((c) => c.key === key) ? key : null;
  }
  const edit = changes.find((c) => c.nodeId === item.nodeId && c.kind === "edit");
  return edit?.key ?? null;
}

export function MergeChangeNav({
  items,
  onSelect,
}: {
  items: MergeChangeNavItem[];
  onSelect: (nodeId: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <Collapsible className="pointer-events-auto relative z-20">
      <CollapsibleTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 max-w-48 gap-1.5 rounded-full border-border/80 bg-background/95 px-3 text-xs shadow-sm backdrop-blur-sm"
        >
          <span className="truncate">
            {items.length} {items.length === 1 ? "change" : "changes"}
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="absolute top-full left-1/2 mt-1.5 w-64 -translate-x-1/2">
        <div className="overflow-hidden rounded-xl border border-border/80 bg-background/95 shadow-lg backdrop-blur-sm">
          <ul className="max-h-48 overflow-y-auto py-1">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/50"
                  onClick={() => onSelect(item.nodeId)}
                >
                  <span
                    className={cn("size-2 shrink-0 rounded-full", KIND_DOT[item.kind])}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {item.label}
                  </span>
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {KIND_LABEL[item.kind]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
