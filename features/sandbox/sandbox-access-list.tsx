"use client";

import { useMemo, useState } from "react";
import { Layers3, Search, Users } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedItem, SegmentedTrack } from "@/components/ui/segmented-control";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useActor } from "@/features/auth/auth-provider";
import { ShareSandboxDialog } from "./share-dialog";
import type { SandboxAccessOverview } from "./sharing";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function ownerDisplayName(name: string | null | undefined): string {
  return name?.trim() || "Unknown owner";
}

export function SandboxAccessList({ rows }: { rows: SandboxAccessOverview[] }) {
  const actor = useActor();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SandboxAccessOverview | null>(null);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const visibleRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows
      .map((row) => ({
        ...row,
        ownerName: ownerDisplayName(row.ownerName),
      }))
      .filter((row) => {
        if (scope === "mine" && row.ownerAuthId !== actor?.authId) return false;
        if (!search) return true;
        return (
          row.name.toLowerCase().includes(search) ||
          row.ownerName.toLowerCase().includes(search)
        );
      });
  }, [actor?.authId, query, rows, scope]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Sandbox access</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review who can view or edit every sandbox.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedTrack role="tablist" aria-label="Sandbox ownership">
          <SegmentedItem
            role="tab"
            aria-selected={scope === "mine"}
            active={scope === "mine"}
            onClick={() => setScope("mine")}
          >
            My sandboxes
          </SegmentedItem>
          <SegmentedItem
            role="tab"
            aria-selected={scope === "all"}
            active={scope === "all"}
            onClick={() => setScope("all")}
          >
            All sandboxes
          </SegmentedItem>
        </SegmentedTrack>
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="bg-white pl-9"
            placeholder="Search sandboxes by name or owner..."
            aria-label="Search sandboxes by name or owner"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xs">
        <Table>
          <TableHeader className="bg-gray-50">
            <TableRow className="border-b border-gray-100 hover:bg-gray-50">
              <TableHead className="h-auto px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Sandbox
              </TableHead>
              <TableHead className="h-auto px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Owner
              </TableHead>
              <TableHead className="h-auto px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Status
              </TableHead>
              <TableHead className="h-auto px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Viewers
              </TableHead>
              <TableHead className="h-auto px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Editors
              </TableHead>
              <TableHead className="h-auto w-40 px-4 py-3 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => (
              <TableRow
                key={row.treeId}
                className="border-b border-gray-100 transition-colors hover:bg-gray-50/60"
              >
                <TableCell className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <Layers3 className="size-4 shrink-0 text-gray-400" />
                    <span className="font-medium text-gray-900">{row.name}</span>
                  </div>
                </TableCell>
                <TableCell className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <Avatar className="size-7">
                      <AvatarFallback className="bg-emerald-50 text-[10px] font-semibold text-emerald-700">
                        {initials(row.ownerName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium text-gray-700">{row.ownerName}</span>
                  </div>
                </TableCell>
                <TableCell className="px-4 py-3.5">
                  <span
                    className={
                      row.archived
                        ? "inline-flex rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600"
                        : "inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700"
                    }
                  >
                    {row.archived ? "Archived" : "Active"}
                  </span>
                </TableCell>
                <TableCell className="px-4 py-3.5 tabular-nums">
                  {row.viewerCount}
                </TableCell>
                <TableCell className="px-4 py-3.5 tabular-nums">
                  {row.editorCount}
                </TableCell>
                <TableCell className="px-4 py-3.5 text-right">
                  <Button
                    variant="outline"
                    className="h-auto gap-1.5 rounded-lg border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-none transition-colors hover:bg-gray-100 hover:text-gray-900"
                    aria-label={`Manage access for ${row.name}`}
                    onClick={(event) => {
                      setTrigger(event.currentTarget);
                      setSelected(row);
                    }}
                  >
                    <Users className="size-3.5" />
                    Manage access
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {visibleRows.length === 0 ? (
              <TableRow className="border-0 hover:bg-transparent">
                <TableCell
                  colSpan={6}
                  className="px-4 py-10 text-center text-sm text-gray-500"
                >
                  {query.trim()
                    ? "No sandboxes match your search."
                    : scope === "mine"
                      ? "You don’t own any sandboxes."
                      : "No sandboxes."}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <ShareSandboxDialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        sandboxId={selected?.treeId ?? null}
        sandboxName={selected?.name ?? null}
        returnFocus={trigger}
        showPastAccess
      />
    </div>
  );
}
