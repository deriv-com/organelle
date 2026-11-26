"use client";

/**
 * Chart-local search. People then teams. Index returns all
 * hits; the overlay shows 50 per section.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { deptColor } from "./card";
import { indexFromRows, type ChartRow } from "./chart-row";
import { searchChart, type ChartSearchHit } from "./search-index";

export const SEARCH_SECTION_CAP = 50;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function ChartSearch({
  rows,
  onSelect,
  includeJobTitle = false,
}: {
  rows: ChartRow[];
  onSelect: (nodeId: string) => void;
  includeJobTitle?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const colors = useMemo(
    () =>
      rows.length === 0 ? new Map<string, string>() : indexFromRows(rows).deptColorById,
    [rows],
  );

  const results =
    query.trim().length > 0 ? searchChart(rows, query, { includeJobTitle }) : [];
  const people = results.filter((hit) => hit.kind === "seat");
  const teams = results.filter((hit) => hit.kind === "header");
  const displayed = [
    ...people.slice(0, SEARCH_SECTION_CAP),
    ...teams.slice(0, SEARCH_SECTION_CAP),
  ];

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const go = (nodeId: string) => {
    setQuery("");
    setOpen(false);
    onSelect(nodeId);
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-[28rem]">
      <form autoComplete="off" onSubmit={(event) => event.preventDefault()}>
        <InputGroup className="rounded-xl bg-background/95 shadow-sm">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            name="chart-search"
            autoComplete="one-time-code"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveId("");
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (
                (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                displayed.length > 0
              ) {
                event.preventDefault();
                setOpen(true);
                const current = displayed.findIndex((hit) => hit.nodeId === activeId);
                const next =
                  current < 0
                    ? event.key === "ArrowDown"
                      ? 0
                      : displayed.length - 1
                    : (current +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        displayed.length) %
                      displayed.length;
                setActiveId(displayed[next]!.nodeId);
              } else if (event.key === "Enter" && open) {
                event.preventDefault();
                const hit =
                  displayed.find((hit) => hit.nodeId === activeId) ?? displayed[0];
                if (hit) go(hit.nodeId);
              } else if (event.key === "Escape") {
                setQuery("");
                setOpen(false);
              }
            }}
            placeholder={rows.length === 0 ? "Loading…" : "Search people and teams"}
            disabled={rows.length === 0}
            aria-label="Search people and teams"
          />
        </InputGroup>
      </form>
      {open && query.trim().length > 0 ? (
        <Command
          shouldFilter={false}
          value={activeId}
          onValueChange={setActiveId}
          className="absolute top-full z-50 mt-1 flex h-auto max-h-[min(24rem,70vh)] w-full flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-md"
        >
          <CommandList className="max-h-[min(24rem,70vh)] overflow-y-auto p-1">
            <CommandEmpty>No matches.</CommandEmpty>
            {people.length > 0 ? (
              <CommandGroup heading="People">
                {people.slice(0, SEARCH_SECTION_CAP).map((hit) => (
                  <HitItem key={hit.nodeId} hit={hit} colors={colors} onSelect={go} />
                ))}
                {people.length > SEARCH_SECTION_CAP ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    {people.length - SEARCH_SECTION_CAP} more — refine search
                  </p>
                ) : null}
              </CommandGroup>
            ) : null}
            {teams.length > 0 ? (
              <CommandGroup heading="Teams">
                {teams.slice(0, SEARCH_SECTION_CAP).map((hit) => (
                  <HitItem key={hit.nodeId} hit={hit} colors={colors} onSelect={go} />
                ))}
                {teams.length > SEARCH_SECTION_CAP ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    {teams.length - SEARCH_SECTION_CAP} more — refine search
                  </p>
                ) : null}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      ) : null}
    </div>
  );
}

function HitItem({
  hit,
  colors,
  onSelect,
}: {
  hit: ChartSearchHit;
  colors: Map<string, string>;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <CommandItem
      value={hit.nodeId}
      onSelect={() => onSelect(hit.nodeId)}
      className="items-start py-2"
    >
      {hit.kind === "seat" ? (
        <Avatar className="mt-0.5 size-8">
          {hit.avatarUrl ? <AvatarImage src={hit.avatarUrl} alt="" /> : null}
          <AvatarFallback className="text-[10px]">{initials(hit.title)}</AvatarFallback>
        </Avatar>
      ) : (
        <span
          className="mt-1.5 size-2.5 shrink-0 rounded-full"
          style={{ background: deptColor(hit.dept, colors) }}
        />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{hit.title}</span>
        {hit.subtitle ? (
          <span className="truncate text-xs text-muted-foreground">{hit.subtitle}</span>
        ) : null}
      </span>
    </CommandItem>
  );
}
