import { toast } from "sonner";

import { reportClientEvent } from "@/features/telemetry/client-reporter";

export const CHART_LIMIT_TOAST_ID = "chart-limit";
export const CHART_LIMIT_MESSAGE =
  "The chart is limited to 400 visible items. Collapse another team to show more.";

export function notifyChartLimit(limited: boolean): void {
  if (!limited) return;
  toast.message(CHART_LIMIT_MESSAGE, { id: CHART_LIMIT_TOAST_ID });
  reportClientEvent({ type: "chart_limit", message: CHART_LIMIT_MESSAGE });
}
