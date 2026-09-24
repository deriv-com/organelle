"use client";

/**
 * Card context menu. Opened by OrgChartView on
 * right-click over a card in editable mode; empty canvas keeps the browser
 * menu. Fixed-position, closes on click-away / Escape / scroll.
 */

import { useEffect } from "react";
import {
  FolderPlus,
  ListTree,
  Pencil,
  Trash2,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";

import { Separator } from "@/components/ui/separator";
import { SegmentedItem, SegmentedTrack } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";

export interface ContextMenuState {
  x: number;
  y: number;
  nodeId: string;
  label: string;
  kind: "header" | "seat";
  isRoot: boolean;
  isAssistant: boolean;
  leafGridColumns: number;
  canAddAssistant: boolean;
  canPlaceAsAssistant: boolean;
}

const COLUMN_OPTIONS = [1, 2, 3, 4, 5] as const;

export function CardContextMenu({
  menu,
  onAdd,
  onAddAssistant,
  onPlaceAssistant,
  onPlaceInTeam,
  onRename,
  onDelete,
  onSetLeafGridColumns,
  onClose,
}: {
  menu: ContextMenuState;
  onAdd: (nodeId: string, kind: "header" | "seat") => void;
  onAddAssistant: (nodeId: string) => void;
  onPlaceAssistant: (nodeId: string) => void;
  onPlaceInTeam: (nodeId: string) => void;
  onRename: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onSetLeafGridColumns: (nodeId: string, columns: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("keydown", onKey);
    document.addEventListener("wheel", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("wheel", onScroll, true);
    };
  }, [onClose]);

  // Keep the menu inside the viewport.
  const left = Math.min(menu.x, window.innerWidth - 220);
  const top = Math.min(menu.y, window.innerHeight - 260);

  const item =
    "group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-foreground/90 transition-colors hover:bg-accent hover:text-accent-foreground outline-none select-none";

  const destructiveItem =
    "group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 hover:text-destructive outline-none select-none";

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        role="menu"
        className="fixed z-50 min-w-44 rounded-xl border border-border/80 bg-popover p-1 text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
        style={{ left, top }}
      >
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => onAdd(menu.nodeId, "seat")}
        >
          <UserPlus className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
          <span>Add position</span>
        </button>
        {menu.canAddAssistant && (
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => onAddAssistant(menu.nodeId)}
          >
            <UserRound className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
            <span>Add assistant</span>
          </button>
        )}
        {menu.canPlaceAsAssistant && (
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => onPlaceAssistant(menu.nodeId)}
          >
            <Users className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
            <span>Place as assistant</span>
          </button>
        )}
        {menu.isAssistant && (
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => onPlaceInTeam(menu.nodeId)}
          >
            <ListTree className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
            <span>Place in team</span>
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => onAdd(menu.nodeId, "header")}
        >
          <FolderPlus className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
          <span>Add team</span>
        </button>
        {menu.kind === "header" && (
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => onRename(menu.nodeId)}
          >
            <Pencil className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
            <span>Rename team</span>
          </button>
        )}
        {!menu.isAssistant && (
          <>
            <Separator className="my-1 bg-border/80" />
            <div className="px-2 pb-2">
              <div className="px-0.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Columns
              </div>
              <SegmentedTrack
                fullWidth
                role="radiogroup"
                aria-label="Leaf grid columns"
                className="h-8"
              >
                {COLUMN_OPTIONS.map((n) => {
                  const selected = menu.leafGridColumns === n;
                  return (
                    <SegmentedItem
                      key={n}
                      fullWidth
                      role="menuitemradio"
                      aria-checked={selected}
                      active={selected}
                      className={cn(
                        "text-xs tabular-nums",
                        selected
                          ? "bg-primary text-primary-foreground shadow-none hover:bg-primary/90 hover:text-primary-foreground"
                          : "hover:bg-accent hover:text-accent-foreground",
                      )}
                      onClick={() => {
                        if (selected) {
                          onClose();
                          return;
                        }
                        onSetLeafGridColumns(menu.nodeId, n);
                      }}
                    >
                      {n}
                    </SegmentedItem>
                  );
                })}
              </SegmentedTrack>
            </div>
          </>
        )}
        {!menu.isRoot && (
          <>
            <Separator className="my-1 bg-border/80" />
            <button
              type="button"
              role="menuitem"
              className={destructiveItem}
              onClick={() => onDelete(menu.nodeId)}
            >
              <Trash2 className="size-4 text-destructive/80 transition-colors group-hover:text-destructive" />
              <span>Delete {menu.kind === "header" ? "team" : "position"}</span>
            </button>
          </>
        )}
      </div>
    </>
  );
}
