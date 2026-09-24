import Link from "next/link";

import { PageEmpty } from "@/components/page-state";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="h-full">
      <PageEmpty
        title="This page doesn’t exist"
        body="Check the link, or go back to the chart."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/chart">Back to the chart</Link>
          </Button>
        }
      />
    </main>
  );
}
