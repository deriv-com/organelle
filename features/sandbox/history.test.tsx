/** @vitest-environment jsdom */

import { cleanup, render, within, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ getSandboxHistory: vi.fn() }));

import type { HistoryBlock } from "./history-block";
import { useOrgData } from "@/store/org-data";
import { getSandboxHistory } from "./actions";
import { SandboxHistory, HistoryDetails, HistoryTitle } from "./history";

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

describe("sandbox history filters", () => {
  const entry = (id: string, actor: string, op: string) => ({
    id,
    op,
    node_id: "team",
    employee_auth_id: null,
    actor_name: actor,
    actor_auth_id: id,
    before: { name: "Old Team" },
    after: { name: "Example Team" },
    created_at: "2026-09-22T08:54:00.000Z",
    command_id: id,
    command_kind: "user" as const,
    undoes_command_id: null,
  });
  it("combines text, action and person filters and resets on another tree", async () => {
    useOrgData.setState({
      historyOpen: true,
      sandboxCanReadHistory: true,
      chartRows: [],
    });
    vi.mocked(getSandboxHistory).mockResolvedValue([
      entry("1", "Example Editor", "rename_header"),
      entry("2", "Other Editor", "create_header"),
    ]);
    const view = render(<SandboxHistory treeId="tree-a" />);
    const search = await view.findByRole("searchbox", { name: "Search changes" });
    await waitFor(() => expect(view.getByText(/by Example Editor/)).toBeTruthy());
    fireEvent.change(search, { target: { value: "EXAMPLE" } });
    fireEvent.change(view.getByLabelText("Action"), { target: { value: "Rename" } });
    fireEvent.change(view.getByLabelText("Performed by"), { target: { value: "1" } });
    expect(view.queryByText(/by Other Editor/)).toBeNull();
    fireEvent.change(search, { target: { value: "no such item" } });
    expect(view.getByText("No matching changes.")).toBeTruthy();
    view.rerender(<SandboxHistory treeId="tree-b" />);
    await waitFor(() =>
      expect(
        (view.getByRole("searchbox", { name: "Search changes" }) as HTMLInputElement)
          .value,
      ).toBe(""),
    );
  });
  it("does not clear a separate dialog's lock when the history sheet was closed", () => {
    useOrgData.setState({ historyOpen: false, sandboxCanReadHistory: true });
    document.body.style.pointerEvents = "none";
    document.body.setAttribute("data-scroll-locked", "1");
    const view = render(<SandboxHistory treeId="tree-a" />);
    view.unmount();
    expect(document.body.style.pointerEvents).toBe("none");
    document.body.style.pointerEvents = "";
    document.body.removeAttribute("data-scroll-locked");
  });
});
