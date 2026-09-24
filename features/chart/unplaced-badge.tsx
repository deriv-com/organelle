"use client";

/**
 * Editable-sandbox Unplaced overlay. Informational list only —
 * separate from the full directory.
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import type { UnplacedPerson } from "./unplaced";

export function UnplacedBadge({ items }: { items: UnplacedPerson[] }) {
  if (items.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Unplaced, ${items.length}`}
          className="h-8 gap-1.5 rounded-xl border-border bg-background/95 px-2.5 shadow-sm"
        >
          Unplaced
          <Badge variant="filterCount">{items.length}</Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 max-h-96 overflow-y-auto p-1">
        <ul className="flex flex-col">
          {items.map((person) => (
            <li key={person.authId} className="rounded-md px-2.5 py-2 text-sm">
              <div className="truncate font-medium">{person.displayName}</div>
              {person.displayTitle ? (
                <div className="truncate text-xs text-muted-foreground">
                  {person.displayTitle}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
