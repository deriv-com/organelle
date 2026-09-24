"use client";

import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useCanExport } from "@/features/auth/auth-provider";

export function DownloadSeatExportButton({
  size = "icon-sm",
}: {
  size?: "sm" | "icon" | "icon-sm" | "default";
}) {
  const canExport = useCanExport();

  if (!canExport) return null;

  const download = async () => {
    try {
      const res = await fetch("/api/export/seats");
      if (!res.ok) {
        toast.error("Download failed");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? "organelle_report.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Download failed");
    }
  };

  return (
    <Button variant="outline" size={size} onClick={() => void download()}>
      <Download data-icon />
      <span className="sr-only">Download</span>
    </Button>
  );
}
