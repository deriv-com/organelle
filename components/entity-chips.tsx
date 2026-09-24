"use client";

import type { ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { deptColor } from "@/features/chart/card";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function PersonChip({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl?: string | null;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pr-2 pl-0.5 text-xs font-medium">
      <Avatar className="size-5">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback className="text-[9px]">{initials(name)}</AvatarFallback>
      </Avatar>
      <span className="truncate">{name}</span>
    </span>
  );
}

export function TeamChip({
  name,
  dept,
  colors,
}: {
  name: string;
  dept: string | null;
  colors?: Map<string, string>;
}) {
  const color = deptColor(dept, colors);
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium">
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function ChipRow({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {children}
    </span>
  );
}
