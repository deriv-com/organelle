/** @vitest-environment jsdom */

import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ getSandboxHistory: vi.fn() }));

import type { HistoryBlock } from "./history-block";
import { HistoryDetails, HistoryTitle } from "./history";

afterEach(cleanup);

describe("employee update history layout", () => {
  it("keeps field chips in the title and renders value-only detail lines", () => {
    const block: HistoryBlock = {
      id: "change-1",
      createdAt: "2026-09-22T08:54:00.000Z",
      op: "update_employee",
      kind: "Employee updated",
      action: "Updated employee",
      actorName: "Editor Person",
      focusNodeId: null,
      subject: [{ type: "person", name: "Amy Pond", avatarUrl: null }],
      details: [
        {
          label: "Email",
          chips: [],
          text: "amy@example.com → pond@example.com",
        },
        {
          label: "Full name",
          chips: [],
          text: "Amy → Amy Pond",
        },
      ],
    };

    const title = render(<HistoryTitle block={block} />);
    const titleRegion = within(title.container);

    expect(titleRegion.getByText("Updated employee")).toBeTruthy();
    expect(titleRegion.getByText("Amy Pond")).toBeTruthy();
    expect(titleRegion.getByText("Email")).toBeTruthy();
    expect(titleRegion.getByText("Full name")).toBeTruthy();

    const details = render(<HistoryDetails block={block} />);
    const detailsRegion = within(details.container);

    expect(detailsRegion.queryByText("Email")).toBeNull();
    expect(detailsRegion.queryByText("Full name")).toBeNull();
    expect(detailsRegion.getByText("amy@example.com → pond@example.com")).toBeTruthy();
    expect(detailsRegion.getByText("Amy → Amy Pond")).toBeTruthy();
  });
});
