"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Download } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import type { VersionSummary } from "./types";
import {
  downloadChangesCsv,
  publishedAtToKlDate,
} from "@/features/reports/changes/download-changes";

export function VersionList({ versions }: { versions: VersionSummary[] }) {
  const router = useRouter();

  if (versions.length === 0) {
    return (
      <Empty className="border border-dashed bg-background">
        <EmptyHeader>
          <EmptyTitle>No published versions yet</EmptyTitle>
          <EmptyDescription>Merges will show up here as a timeline.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <h1 className="text-sm font-semibold text-foreground/80">Published Versions</h1>
        <span className="rounded-full bg-background px-2.5 py-0.5 text-xs font-semibold text-muted-foreground shadow-2xs">
          {versions.length}
        </span>
      </div>
      <ol className="relative flex flex-col gap-0 border-l border-border/80 pl-6">
        {versions.map((version) => (
          <li key={version.treeId} className="relative pb-6 last:pb-0">
            <span className="absolute top-5 -left-[29px] size-3 rounded-full border-2 border-background bg-primary shadow-xs" />
            <Card
              className="cursor-pointer gap-4 rounded-xl border border-border/70 bg-background p-5 shadow-xs transition-all hover:border-border hover:shadow-sm"
              onClick={() => router.push(`/versions/${version.treeId}`)}
            >
              <CardHeader className="p-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold text-foreground">
                      v{version.versionSeq}
                    </CardTitle>
                    {version.live ? <Badge>Live</Badge> : null}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {version.publishedAt
                      ? new Date(version.publishedAt).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Unknown date"}
                  </span>
                </div>
                <CardDescription className="text-xs text-muted-foreground">
                  <span className="block text-sm font-medium text-foreground">
                    {version.title}
                  </span>
                  <span className="mt-0.5 block">
                    {version.mergerName
                      ? `By ${version.mergerName}`
                      : "Initial publish"}
                    {version.countsLabel ? ` · ${version.countsLabel}` : ""}
                  </span>
                </CardDescription>
              </CardHeader>
              <CardFooter className="justify-end gap-2 p-0 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 rounded-lg border-input bg-background px-3 text-xs font-medium hover:bg-accent"
                  onClick={(event) => {
                    event.stopPropagation();
                    void downloadChangesCsv(publishedAtToKlDate(version.publishedAt));
                  }}
                >
                  <Download className="size-3.5 opacity-70" />
                  Download changes
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 rounded-lg border-input bg-background px-3 text-xs font-medium hover:bg-accent"
                  onClick={(event) => {
                    event.stopPropagation();
                    router.push(`/versions/${version.treeId}`);
                  }}
                >
                  Open chart
                  <ArrowRight className="size-3.5 opacity-50" />
                </Button>
              </CardFooter>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
