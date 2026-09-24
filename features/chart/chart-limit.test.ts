import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHART_LIMIT_MESSAGE,
  CHART_LIMIT_TOAST_ID,
  notifyChartLimit,
} from "./chart-limit";
import { reportClientEvent } from "@/features/telemetry/client-reporter";

vi.mock("sonner", () => ({
  toast: { message: vi.fn() },
}));

vi.mock("@/features/telemetry/client-reporter", () => ({
  reportClientEvent: vi.fn(),
}));

import { toast } from "sonner";

describe("notifyChartLimit", () => {
  beforeEach(() => {
    vi.mocked(toast.message).mockClear();
    vi.mocked(reportClientEvent).mockClear();
  });

  it("does nothing when the expansion was not limited", () => {
    notifyChartLimit(false);
    expect(toast.message).not.toHaveBeenCalled();
    expect(reportClientEvent).not.toHaveBeenCalled();
  });

  it("toasts the 400-item copy with a stable id when limited", () => {
    notifyChartLimit(true);
    expect(toast.message).toHaveBeenCalledWith(CHART_LIMIT_MESSAGE, {
      id: CHART_LIMIT_TOAST_ID,
    });
    expect(reportClientEvent).toHaveBeenCalledWith({
      type: "chart_limit",
      message: CHART_LIMIT_MESSAGE,
    });
  });
});
