"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { dataTableSurfaceClass, dataTableTrackClass } from "./styles";

export interface DataTableShellProps {
  children: ReactNode;
  empty?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function DataTableShell({
  children,
  empty,
  footer,
  className,
}: DataTableShellProps) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}>
      <div className={dataTableTrackClass}>
        <div className={dataTableSurfaceClass}>
          {children}
          {empty ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              {empty}
            </div>
          ) : null}
        </div>
      </div>
      {footer}
    </div>
  );
}
