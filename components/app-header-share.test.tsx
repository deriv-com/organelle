/** @vitest-environment jsdom */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/features/auth/auth-provider";
import { useOrgData } from "@/store/org-data";
import { AppHeader } from "./app-header";

const navigation = vi.hoisted(() => ({
  pathname: "/sandbox/d1c8f5db-bfa9-4b7a-bbeb-b3be2b5adb25",
  push: vi.fn(),
}));
const sharing = vi.hoisted(() => ({
  getSandboxShareDetails: vi.fn(),
  grantSandboxAccess: vi.fn(),
  revokeSandboxAccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock("next/image", () => ({
  default: ({ src }: { src: string }) => <span data-image-src={src} />,
}));
vi.mock("@/features/reports/changes/versions-header-actions", () => ({
  VersionsHeaderActions: () => null,
}));
vi.mock("@/features/reports/download-seat-export-button", () => ({
  DownloadSeatExportButton: () => null,
}));
vi.mock("@/features/versions/actions", () => ({ restoreVersion: vi.fn() }));
vi.mock("@/features/sandbox/create-dialog", () => ({
  CreateSandboxDialog: () => null,
}));
vi.mock("@/features/sandbox/sharing", () => sharing);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  navigation.pathname = "/sandbox/d1c8f5db-bfa9-4b7a-bbeb-b3be2b5adb25";
  sharing.getSandboxShareDetails.mockResolvedValue({
    treeId: "d1c8f5db-bfa9-4b7a-bbeb-b3be2b5adb25",
    name: "Finance restructure",
    ownerName: "Owner",
    ownerEmail: "owner@example.com",
    archived: false,
    canManage: true,
    shares: [],
    recipients: [],
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderHeader(archived: boolean) {
  useOrgData.getState().setData({
    treeId: "d1c8f5db-bfa9-4b7a-bbeb-b3be2b5adb25",
    treeKind: "sandbox",
    versionSeq: null,
    sandboxName: "Finance restructure",
    sandboxOwnerAuthId: "owner-1",
    sandboxArchived: archived,
    sandboxEditable: !archived,
    sandboxCanPublish: !archived,
    sandboxCanShare: true,
    sandboxCanReadHistory: true,
    chartRows: [],
    directoryRows: [],
  });

  return render(
    <AuthProvider
      actor={{
        authId: "owner-1",
        email: "owner@example.com",
        name: "Owner",
        role: "publisher",
      }}
    >
      <TooltipProvider>
        <AppHeader />
      </TooltipProvider>
    </AuthProvider>,
  );
}

describe("sandbox topbar sharing", () => {
  it.each([false, true])(
    "opens from an owner sandbox when archived=%s",
    async (archived) => {
      renderHeader(archived);

      fireEvent.click(screen.getByRole("button", { name: "Share" }));

      const dialog = screen.getByRole("dialog", { name: "Share sandbox" });
      expect(
        within(dialog).getByText("Give someone access to Finance restructure only."),
      ).toBeTruthy();
      expect(
        await within(dialog).findByRole("combobox", { name: "Add people" }),
      ).toBeTruthy();
    },
  );

  it("shows Publish and the link footer to Publisher on another owner's sandbox", async () => {
    useOrgData.getState().setData({
      treeId: "d1c8f5db-bfa9-4b7a-bbeb-b3be2b5adb25",
      treeKind: "sandbox",
      versionSeq: null,
      sandboxName: "Finance restructure",
      sandboxOwnerAuthId: "owner-1",
      sandboxArchived: false,
      sandboxEditable: false,
      sandboxCanPublish: true,
      sandboxCanShare: true,
      sandboxCanReadHistory: false,
      chartRows: [],
      directoryRows: [],
    });

    render(
      <AuthProvider
        actor={{
          authId: "publisher-1",
          email: "publisher@example.com",
          name: "Publisher",
          role: "publisher",
        }}
      >
        <TooltipProvider>
          <AppHeader />
        </TooltipProvider>
      </AuthProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(navigation.push).toHaveBeenCalledWith(
      "/sandbox/d1c8f5db-bfa9-4b7a-bbeb-b3be2b5adb25/merge",
    );

    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const dialog = screen.getByRole("dialog", { name: "Share sandbox" });
    expect(
      await within(dialog).findByRole("button", { name: "Copy link" }),
    ).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Invite" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("shows an Editor pill to an editable shared recipient", () => {
    useOrgData.getState().setData({
      treeId: "d1c8f5db-bfa9-4b7a-bbeb-b3be2b5adb25",
      treeKind: "sandbox",
      versionSeq: null,
      sandboxName: "Finance restructure",
      sandboxOwnerAuthId: "owner-1",
      sandboxArchived: false,
      sandboxEditable: true,
      sandboxCanPublish: false,
      sandboxCanShare: false,
      sandboxCanReadHistory: false,
      chartRows: [],
      directoryRows: [],
    });

    render(
      <AuthProvider
        actor={{
          authId: "shared-editor-1",
          email: "shared-editor@example.com",
          name: "Shared Editor",
          role: "viewer",
        }}
      >
        <TooltipProvider>
          <AppHeader />
        </TooltipProvider>
      </AuthProvider>,
    );

    expect(screen.getByText("Editor")).toBeTruthy();
    expect(screen.queryByText("View only")).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("does not show stale view-only chrome while sandbox access is loading", () => {
    useOrgData.getState().setData({
      treeId: "00000000-0000-4000-8000-000000000001",
      treeKind: "sandbox",
      versionSeq: null,
      sandboxName: "Previous sandbox",
      sandboxOwnerAuthId: "owner-1",
      sandboxArchived: false,
      sandboxEditable: false,
      sandboxCanPublish: true,
      sandboxCanShare: false,
      sandboxCanReadHistory: false,
      chartRows: [],
      directoryRows: [],
    });

    render(
      <AuthProvider
        actor={{
          authId: "shared-editor-1",
          email: "shared-editor@example.com",
          name: "Shared Editor",
          role: "viewer",
        }}
      >
        <TooltipProvider>
          <AppHeader />
        </TooltipProvider>
      </AuthProvider>,
    );

    expect(screen.queryByText("View only")).toBeNull();
    expect(screen.queryByText("Previous sandbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();

    act(() => {
      useOrgData.getState().setData({
        treeId: "d1c8f5db-bfa9-4b7a-bbeb-b3be2b5adb25",
        treeKind: "sandbox",
        versionSeq: null,
        sandboxName: "Finance restructure",
        sandboxOwnerAuthId: "owner-1",
        sandboxArchived: false,
        sandboxEditable: true,
        sandboxCanPublish: false,
        sandboxCanShare: false,
        sandboxCanReadHistory: false,
        chartRows: [],
        directoryRows: [],
      });
    });

    expect(screen.getByText("Editor")).toBeTruthy();
    expect(screen.queryByText("View only")).toBeNull();
  });
});

describe("responsive primary navigation", () => {
  function renderAdminHeader() {
    return render(
      <AuthProvider
        actor={{
          authId: "admin-1",
          email: "admin@example.com",
          name: "Admin",
          role: "admin",
        }}
      >
        <TooltipProvider>
          <AppHeader />
        </TooltipProvider>
      </AuthProvider>,
    );
  }

  it("exposes every admin destination from the compact menu", async () => {
    navigation.pathname = "/chart";
    renderAdminHeader();

    const trigger = screen.getByRole("button", { name: "Open navigation" });
    expect(trigger.textContent).toContain("Functional chart");
    fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });

    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(8);
    expect(
      within(menu)
        .getByRole("menuitem", { name: "Functional chart" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(within(menu).getByRole("menuitem", { name: "Users" })).toBeTruthy();
  });

  it("keeps core destinations visible and puts admin destinations under More", async () => {
    navigation.pathname = "/audit";
    renderAdminHeader();

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Functional chart", "Directory", "Sandboxes"]);

    const more = within(nav).getByRole("button", { name: "More navigation" });
    fireEvent.keyDown(more, { key: "Enter", code: "Enter" });

    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(5);
    expect(
      within(menu)
        .getByRole("menuitem", { name: "Audit" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(within(menu).getByRole("menuitem", { name: "Users" })).toBeTruthy();
  });
});
