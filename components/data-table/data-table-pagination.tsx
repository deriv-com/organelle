"use client";

import { useState, type MouseEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@/components/ui/pagination";
import { segmentedItemClass } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";

export function pageWindow(
  page: number,
  pageCount: number,
): Array<number | "ellipsis"> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  const items: Array<number | "ellipsis"> = [1];
  if (start > 2) items.push("ellipsis");
  for (let n = start; n <= end; n++) items.push(n);
  if (end < pageCount - 1) items.push("ellipsis");
  items.push(pageCount);
  return items;
}

export function usePaginatedItems<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.min(page, pageCount);
  return {
    page: clampedPage,
    setPage,
    pageCount,
    items: items.slice((clampedPage - 1) * pageSize, clampedPage * pageSize),
  };
}

export function DataTablePagination({
  page,
  pageCount,
  onPageChange,
  getPageHref,
  hideWhenSinglePage = true,
  trackClassName,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  getPageHref?: (page: number) => string;
  hideWhenSinglePage?: boolean;
  trackClassName?: string;
}) {
  if (hideWhenSinglePage && pageCount <= 1) return null;
  const pages = pageWindow(page, pageCount);
  const navigate = (event: MouseEvent, nextPage: number) => {
    event.preventDefault();
    onPageChange(nextPage);
  };

  return (
    <Pagination className="mx-0 w-auto justify-end">
      <PaginationContent
        className={cn("h-9 min-w-0 gap-0 rounded-lg bg-muted p-1", trackClassName)}
      >
        <PaginationItem>
          <button
            type="button"
            aria-label="Go to previous page"
            disabled={page <= 1}
            className={cn(
              segmentedItemClass(false),
              page <= 1 && "pointer-events-none opacity-50",
            )}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="size-4" />
          </button>
        </PaginationItem>
        {pages.map((item, index) =>
          item === "ellipsis" ? (
            <PaginationItem key={`e-${index}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={item}>
              {getPageHref ? (
                <a
                  aria-current={item === page ? "page" : undefined}
                  className={segmentedItemClass(item === page)}
                  href={getPageHref(item)}
                  onClick={(event) => navigate(event, item)}
                >
                  {item}
                </a>
              ) : (
                <button
                  type="button"
                  aria-current={item === page ? "page" : undefined}
                  className={segmentedItemClass(item === page)}
                  onClick={() => onPageChange(item)}
                >
                  {item}
                </button>
              )}
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <button
            type="button"
            aria-label="Go to next page"
            disabled={page >= pageCount}
            className={cn(
              segmentedItemClass(false),
              page >= pageCount && "pointer-events-none opacity-50",
            )}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight className="size-4" />
          </button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
