"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ComingNextButton({
  children,
  variant = "outline",
  size = "sm",
}: {
  children: ReactNode;
  variant?: "outline" | "ghost" | "default";
  size?: "sm" | "icon" | "icon-sm" | "default";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-not-allowed">
          <Button variant={variant} size={size} disabled>
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Coming next</TooltipContent>
    </Tooltip>
  );
}
