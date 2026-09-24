"use client";

import type { ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function personInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export interface PersonCellProps {
  name: string;
  email: string;
  avatarUrl?: string | null;
  className?: string;
  onClick?: () => void;
  trailing?: ReactNode;
}

export function PersonCell({
  name,
  email,
  avatarUrl,
  className,
  onClick,
  trailing,
}: PersonCellProps) {
  const content = (
    <>
      <Avatar className="size-8 shrink-0">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback>{personInitials(name)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0">
        <span className="block truncate font-medium text-foreground">{name}</span>
        <span className="block truncate text-muted-foreground">{email}</span>
      </span>
      {trailing}
    </>
  );

  const layout = cn("flex min-w-0 items-center gap-3 text-left", className);

  if (onClick) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        className={layout}
      >
        {content}
      </button>
    );
  }

  return <div className={layout}>{content}</div>;
}
