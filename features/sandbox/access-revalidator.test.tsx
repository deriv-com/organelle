/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOrgData } from "@/store/org-data";
import { SandboxAccessRevalidator } from "./access-revalidator";

const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

describe("SandboxAccessRevalidator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgData.getState().setData({
      treeId: "sandbox-1",
      treeKind: "sandbox",
      versionSeq: 12,
      sandboxName: "Shared plan",
      chartRows: [
        {
          id: "root",
          parentId: "",
          kind: "header",
          sortOrder: 0,
          rowVersion: 1,
          members: [],
        },
      ],
      directoryRows: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("clears an already-open sandbox and redirects when access is revoked", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 403 })),
    );

    render(<SandboxAccessRevalidator treeId="sandbox-1" />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/chart"));
    expect(useOrgData.getState()).toMatchObject({
      treeId: null,
      treeKind: null,
      chartRows: [],
      directoryRows: [],
      sandboxEditable: false,
      sandboxCanPublish: false,
    });
  });

  it("keeps the open sandbox on transient server failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );

    render(<SandboxAccessRevalidator treeId="sandbox-1" />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(router.replace).not.toHaveBeenCalled();
    expect(useOrgData.getState().treeId).toBe("sandbox-1");
  });
  it("closes history when access to history is removed without losing chart access", async () => {
    useOrgData.setState({ sandboxCanReadHistory: true, historyOpen: true });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ canView: true, canReadHistory: false })),
    );
    render(<SandboxAccessRevalidator treeId="sandbox-1" />);
    await waitFor(() =>
      expect(useOrgData.getState().sandboxCanReadHistory).toBe(false),
    );
    expect(useOrgData.getState().historyOpen).toBe(false);
    expect(useOrgData.getState().treeId).toBe("sandbox-1");
    expect(router.replace).not.toHaveBeenCalled();
  });
  it("clears open history as well as the chart on a revoked share", async () => {
    useOrgData.setState({ sandboxCanReadHistory: true, historyOpen: true });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
    );
    render(<SandboxAccessRevalidator treeId="sandbox-1" />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/chart"));
    expect(useOrgData.getState().historyOpen).toBe(false);
  });
});
