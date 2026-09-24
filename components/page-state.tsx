import { type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

export function PageLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[12rem] items-center justify-center gap-2">
      <Spinner className="text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function PageEmpty({
  title,
  body,
  action,
}: {
  title?: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        {title ? <EmptyTitle>{title}</EmptyTitle> : null}
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

export function PageError({ title, onRetry }: { title: string; onRetry?: () => void }) {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
      </EmptyHeader>
      {onRetry ? (
        <EmptyContent>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
