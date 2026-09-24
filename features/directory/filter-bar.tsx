"use client";

/**
 * Directory filter bar: header subtree, office, status,
 * has-peers, multi-role, free text. Clean individual controls with consistent
 * h-9 height, rounded-md geometry, and subtle border-input borders.
 */

import { Check, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import type { SeatMember } from "@/features/chart/chart-row";
import { EMPLOYEE_STATUS_LABELS } from "./employee-fields";
import { EMPTY_FILTERS, type DirectoryFilters } from "./filter";

/** Nested header tree; children are the headers directly beneath this one. */
export interface HeaderOption {
  id: string;
  name: string;
  children: HeaderOption[];
}

const STATUSES: Array<SeatMember["status"]> = [
  "active",
  "joining",
  "serving_notice",
  "inactive",
  "resigned",
];

function findHeader(headers: HeaderOption[], id: string | null): HeaderOption | null {
  if (!id) return null;
  for (const header of headers) {
    if (header.id === id) return header;
    const found = findHeader(header.children, id);
    if (found) return found;
  }
  return null;
}

function HeaderTreeRow({
  header,
  selectedId,
  onSelect,
}: {
  header: HeaderOption;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const name = (
    <button
      type="button"
      className={cn(
        "min-w-0 flex-1 truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
        selectedId === header.id && "bg-accent font-medium",
      )}
      onClick={() => onSelect(header.id)}
    >
      {header.name}
    </button>
  );

  if (header.children.length === 0) {
    return (
      <div className="flex items-center gap-0.5 pr-1">
        <span className="size-7 shrink-0" aria-hidden />
        {name}
      </div>
    );
  }

  return (
    <Collapsible className="w-full">
      <div className="flex items-center gap-0.5 pr-1">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="group flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={`Expand ${header.name}`}
          >
            <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
          </button>
        </CollapsibleTrigger>
        {name}
      </div>
      <CollapsibleContent className="ml-3.5 border-l border-border pl-1">
        {header.children.map((child) => (
          <HeaderTreeRow
            key={child.id}
            header={child}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function HeaderTreePicker({
  headers,
  selectedId,
  onSelect,
}: {
  headers: HeaderOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = findHeader(headers, selectedId);
  // Rows are plain buttons, not DropdownMenuItems, so the chevron can toggle without
  // closing the menu. Selection closes it explicitly.
  const select = (id: string | null) => {
    onSelect(id);
    setOpen(false);
  };
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-9 w-48 justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm font-normal shadow-xs hover:bg-accent hover:text-accent-foreground",
            selectedId ? "font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          <span className="truncate">{selected?.name ?? "All departments"}</span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-80 w-64 overflow-y-auto rounded-md border border-input bg-popover p-1 shadow-md"
      >
        <div className="flex items-center gap-0.5 pr-1">
          <span className="size-7 shrink-0" aria-hidden />
          <button
            type="button"
            className={cn(
              "min-w-0 flex-1 truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
              selectedId === null && "bg-accent font-medium",
            )}
            onClick={() => select(null)}
          >
            All departments
          </button>
        </div>
        {headers.map((header) => (
          <HeaderTreeRow
            key={header.id}
            header={header}
            selectedId={selectedId}
            onSelect={select}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

function MultiSelect({
  label,
  options,
  selected,
  onToggle,
  formatOption = (option) => option,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  formatOption?: (value: string) => string;
}) {
  const hasSelected = selected.length > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-9 gap-2 rounded-md border border-input bg-background px-3 text-sm font-normal shadow-xs hover:bg-accent hover:text-accent-foreground",
            hasSelected ? "font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          {label}
          {hasSelected ? (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/20 px-1.5 text-[11px] font-semibold text-foreground">
              {selected.length}
            </span>
          ) : null}
          <ChevronDown className="size-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 w-56 overflow-y-auto rounded-md border border-input bg-popover p-1 shadow-md"
      >
        <DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
          {label}
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {options.length === 0 ? (
            <DropdownMenuItem disabled>No options</DropdownMenuItem>
          ) : (
            options.map((option) => (
              <DropdownMenuCheckboxItem
                key={option}
                checked={selected.includes(option)}
                onCheckedChange={() => onToggle(option)}
                onSelect={(event) => event.preventDefault()}
                className="rounded-sm"
              >
                {formatOption(option)}
              </DropdownMenuCheckboxItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ToggleFilter({
  label,
  pressed,
  onPressedChange,
}: {
  label: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}) {
  return (
    <Toggle
      variant="outline"
      pressed={pressed}
      onPressedChange={onPressedChange}
      className={cn(
        "h-9 gap-2.5 rounded-md border border-input bg-background px-3 text-sm font-normal shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground",
        pressed ? "font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      <div
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-background transition-colors",
          pressed && "border-primary bg-primary text-primary-foreground",
        )}
      >
        {pressed ? <Check className="size-3 stroke-[3]" /> : null}
      </div>
      {label}
    </Toggle>
  );
}

export interface FilterBarProps {
  filters: DirectoryFilters;
  onChange: (filters: DirectoryFilters) => void;
  headers: HeaderOption[];
  offices: string[];
  showStatus?: boolean;
}

export function FilterBar({
  filters,
  onChange,
  headers,
  offices,
  showStatus = true,
}: FilterBarProps) {
  const set = (patch: Partial<DirectoryFilters>) => onChange({ ...filters, ...patch });
  const filtersActive =
    filters.text.trim() !== "" ||
    filters.headerId != null ||
    filters.offices.length > 0 ||
    (showStatus && filters.statuses.length > 0) ||
    filters.hasPeers ||
    filters.multiRole;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 py-4">
      <InputGroup className="h-9 w-72 min-w-48 rounded-md border border-input bg-background shadow-xs">
        <InputGroupAddon>
          <Search className="size-4 text-muted-foreground" />
        </InputGroupAddon>
        <InputGroupInput
          name="directory-search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          value={filters.text}
          onChange={(event) => set({ text: event.target.value })}
          placeholder="Filter by name, team…"
          aria-label="Filter directory"
          className="text-sm"
        />
      </InputGroup>
      <HeaderTreePicker
        headers={headers}
        selectedId={filters.headerId}
        onSelect={(id) => set({ headerId: id })}
      />
      <MultiSelect
        label="Office"
        options={offices}
        selected={filters.offices}
        onToggle={(office) => set({ offices: toggle(filters.offices, office) })}
      />
      {showStatus ? (
        <MultiSelect
          label="Status"
          options={STATUSES}
          selected={filters.statuses}
          onToggle={(status) =>
            set({ statuses: toggle(filters.statuses, status as SeatMember["status"]) })
          }
          formatOption={(status) =>
            EMPLOYEE_STATUS_LABELS[status as SeatMember["status"]]
          }
        />
      ) : null}
      <ToggleFilter
        label="Has peers"
        pressed={filters.hasPeers}
        onPressedChange={(pressed) => set({ hasPeers: pressed })}
      />
      <ToggleFilter
        label="Multi-role"
        pressed={filters.multiRole}
        onPressedChange={(pressed) => set({ multiRole: pressed })}
      />
      {filtersActive ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => onChange(EMPTY_FILTERS)}
        >
          <X data-icon="inline-start" />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
