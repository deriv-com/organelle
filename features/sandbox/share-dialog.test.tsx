/** @vitest-environment jsdom */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/features/auth/auth-provider";
import type { AppRole } from "@/features/auth/policy";
import { SandboxAccessList } from "./sandbox-access-list";
import { clearSandboxClientCache } from "./sandbox-client-cache";
import { SandboxList } from "./sandbox-list";
import type { SandboxAccessOverview } from "./sharing";
import type { SandboxSummary } from "./types";

const router = vi.hoisted(() => ({ push: vi.fn() }));
const sharing = vi.hoisted(() => ({
  getSandboxShareDetails: vi.fn(),
  grantSandboxAccess: vi.fn(),
  revokeSandboxAccess: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./actions", () => ({
  archiveSandbox: vi.fn(),
  deleteSandbox: vi.fn(),
  restoreSandbox: vi.fn(),
}));
vi.mock("./sharing", () => sharing);

beforeEach(() => {
  vi.clearAllMocks();
  clearSandboxClientCache();
  vi.stubGlobal("React", React);
  Element.prototype.scrollIntoView = vi.fn();
  sharing.getSandboxShareDetails.mockResolvedValue({
    treeId: sandbox.treeId,
    name: sandbox.name,
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

function providers(children: React.ReactNode, role: AppRole = "publisher") {
  return (
    <AuthProvider
      actor={{
        authId: "owner-1",
        email: "owner@example.com",
        name: "Owner",
        role,
      }}
    >
      <TooltipProvider>{children}</TooltipProvider>
    </AuthProvider>
  );
}

const sandbox: SandboxSummary = {
  treeId: "d1c8f5db-bfa9-4b7a-bbeb-b3be2b5adb25",
  name: "Finance restructure",
  createdAt: "2026-09-10T00:00:00.000Z",
  forkedFromSeq: 20,
  changeCount: 5,
  ownerAuthId: "owner-1",
  archived: false,
};

const accessRows: SandboxAccessOverview[] = [
  {
    treeId: sandbox.treeId,
    name: "Finance restructure",
    ownerAuthId: "owner-1",
    ownerName: "Owner",
    archived: false,
    viewerCount: 1,
    editorCount: 2,
    updatedAt: "2026-09-18T00:00:00.000Z",
  },
  {
    treeId: "a19deeb7-2d03-42e4-9a1c-d795575e28d7",
    name: "People operations",
    ownerAuthId: "owner-2",
    ownerName: "Another Owner",
    archived: false,
    viewerCount: 0,
    editorCount: 1,
    updatedAt: "2026-09-17T00:00:00.000Z",
  },
];

describe("sandbox sharing", () => {
  it("opens the functional named-user sharing controls from a card", async () => {
    render(providers(<SandboxList sandboxes={[sandbox]} />));

    const trigger = screen.getByRole("button", { name: "Share Finance restructure" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Share sandbox" });
    expect(
      within(dialog).getByText("Give someone access to Finance restructure only."),
    ).toBeTruthy();
    expect(
      await within(dialog).findByRole("combobox", { name: "Add people" }),
    ).toBeTruthy();
    const search = within(dialog).getByRole("combobox", { name: "Add people" });
    const accessLevel = within(dialog).getByLabelText("Access level");
    expect(search.parentElement?.parentElement?.className).toContain("w-full");
    expect(search.parentElement?.parentElement?.className).toContain("border-gray-200");
    expect(search.parentElement?.parentElement?.className).toContain("min-h-10");
    expect(search.parentElement?.parentElement?.className).toContain("p-2");
    expect(accessLevel.className).toContain("h-10!");
    expect(accessLevel.className).toContain("border-border");
    const footer = dialog.querySelector('[data-slot="dialog-footer"]');
    expect(footer).toBeTruthy();
    expect(
      within(footer as HTMLElement).queryByRole("button", { name: "Invite" }),
    ).toBeNull();
    expect(
      within(dialog).getByRole("heading", { name: "People with access (1)" }),
    ).toBeTruthy();
    expect(within(dialog).getByText("owner@example.com")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Invite" }).className).toContain(
      "bg-emerald-600",
    );
    expect(
      within(footer as HTMLElement).getByRole("button", { name: "Done" }),
    ).toBeTruthy();
    expect(
      within(footer as HTMLElement)
        .getByRole("button", { name: "Copy link" })
        .getAttribute("data-variant"),
    ).toBe("outline");

    fireEvent.click(
      within(footer as HTMLElement).getByRole("button", { name: "Done" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("contains a transient access-loading failure and retries in place", async () => {
    sharing.getSandboxShareDetails.mockRejectedValueOnce(new Error("connection reset"));
    render(providers(<SandboxList sandboxes={[sandbox]} />));

    fireEvent.click(screen.getByRole("button", { name: "Share Finance restructure" }));
    const dialog = screen.getByRole("dialog", { name: "Share sandbox" });
    expect(
      await within(dialog).findByText("Couldn’t load sandbox access."),
    ).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    expect(
      await within(dialog).findByRole("combobox", { name: "Add people" }),
    ).toBeTruthy();
  });

  it("falls back to email when an existing share has no full name", async () => {
    sharing.getSandboxShareDetails.mockResolvedValue({
      treeId: sandbox.treeId,
      name: sandbox.name,
      ownerName: "Owner",
      ownerEmail: "owner@example.com",
      archived: false,
      canManage: true,
      shares: [
        {
          shareId: "share-1",
          authId: "person-1",
          name: null as unknown as string,
          email: "nameless@example.com",
          role: "viewer",
          accessLevel: "viewer",
          grantedAt: "2026-09-20T00:00:00.000Z",
          status: "active",
        },
      ],
      recipients: [],
    });
    render(providers(<SandboxList sandboxes={[sandbox]} />));

    fireEvent.click(screen.getByRole("button", { name: "Share Finance restructure" }));
    const dialog = screen.getByRole("dialog", { name: "Share sandbox" });

    expect(await within(dialog).findAllByText("nameless@example.com")).toHaveLength(2);
    expect(
      within(dialog).getByRole("button", {
        name: "Access for nameless@example.com",
      }),
    ).toBeTruthy();
  });

  it("selects multiple people as chips and invites them with one role", async () => {
    sharing.getSandboxShareDetails.mockResolvedValue({
      treeId: sandbox.treeId,
      name: sandbox.name,
      ownerName: "Owner",
      ownerEmail: "owner@example.com",
      archived: false,
      canManage: true,
      shares: [],
      recipients: [
        {
          authId: "person-1",
          name: "Morgan Fixture",
          email: "morgan@example.com",
          role: "viewer",
        },
        {
          authId: "person-2",
          name: "Taylor Fixture",
          email: "taylor.fixture@example.com",
          role: "viewer",
        },
      ],
    });
    sharing.grantSandboxAccess.mockResolvedValue({ ok: true });
    render(providers(<SandboxList sandboxes={[sandbox]} />));

    fireEvent.click(screen.getByRole("button", { name: "Share Finance restructure" }));
    const dialog = screen.getByRole("dialog", { name: "Share sandbox" });
    const input = await within(dialog).findByRole("combobox", { name: "Add people" });

    fireEvent.change(input, { target: { value: "morgan" } });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Morgan Fixture/ }),
    );
    expect(
      within(dialog).getByRole("button", { name: "Remove Morgan Fixture" }),
    ).toBeTruthy();

    fireEvent.change(input, { target: { value: "taylor" } });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Taylor Fixture/ }),
    );
    expect(
      within(dialog).getByRole("button", { name: "Remove Taylor Fixture" }),
    ).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Invite" }));
    await waitFor(() => expect(sharing.grantSandboxAccess).toHaveBeenCalledTimes(2));
    expect(sharing.grantSandboxAccess).toHaveBeenNthCalledWith(
      1,
      sandbox.treeId,
      "person-1",
      "viewer",
    );
    expect(sharing.grantSandboxAccess).toHaveBeenNthCalledWith(
      2,
      sandbox.treeId,
      "person-2",
      "viewer",
    );
  });

  it("automatically assigns Editor access to publisher recipients", async () => {
    sharing.getSandboxShareDetails.mockResolvedValue({
      treeId: sandbox.treeId,
      name: sandbox.name,
      ownerName: "Owner",
      ownerEmail: "owner@example.com",
      archived: false,
      canManage: true,
      shares: [],
      recipients: [
        {
          authId: "hr-admin-1",
          name: "Taylor Fixture",
          email: "taylor.fixture@example.com",
          role: "publisher",
        },
      ],
    });
    sharing.grantSandboxAccess.mockResolvedValue({ ok: true });
    render(providers(<SandboxList sandboxes={[sandbox]} />));

    fireEvent.click(screen.getByRole("button", { name: "Share Finance restructure" }));
    const dialog = screen.getByRole("dialog", { name: "Share sandbox" });
    const input = await within(dialog).findByRole("combobox", { name: "Add people" });

    fireEvent.change(input, { target: { value: "taylor" } });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Taylor Fixture/ }),
    );

    expect(
      within(dialog).getByText(
        "Editor applies to all selected people. Access ends when the sandbox is published.",
      ),
    ).toBeTruthy();
    const accessLevel = within(dialog).getByLabelText("Access level");
    expect(accessLevel.textContent).toBe("Editor");
    expect(accessLevel.className).toContain("h-10");
    expect(accessLevel.className).toContain("border-border");
    fireEvent.click(within(dialog).getByRole("button", { name: "Invite" }));
    await waitFor(() =>
      expect(sharing.grantSandboxAccess).toHaveBeenCalledWith(
        sandbox.treeId,
        "hr-admin-1",
        "viewer",
      ),
    );
  });

  it("shows and applies different effective access for a mixed Viewer and Admin selection", async () => {
    sharing.getSandboxShareDetails.mockResolvedValue({
      treeId: sandbox.treeId,
      name: sandbox.name,
      ownerName: "Owner",
      ownerEmail: "owner@example.com",
      archived: false,
      canManage: true,
      shares: [],
      recipients: [
        {
          authId: "viewer-1",
          name: "Morgan Fixture",
          email: "morgan@example.com",
          role: "viewer",
        },
        {
          authId: "admin-1",
          name: "Jordan Fixture",
          email: "jordan@example.com",
          role: "admin",
        },
      ],
    });
    sharing.grantSandboxAccess.mockResolvedValue({ ok: true });
    render(providers(<SandboxList sandboxes={[sandbox]} />));

    fireEvent.click(screen.getByRole("button", { name: "Share Finance restructure" }));
    const dialog = screen.getByRole("dialog", { name: "Share sandbox" });
    const input = await within(dialog).findByRole("combobox", { name: "Add people" });

    fireEvent.change(input, { target: { value: "morgan" } });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Morgan Fixture/ }),
    );
    fireEvent.change(input, { target: { value: "jordan" } });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Jordan Fixture/ }),
    );

    expect(
      within(dialog).getByText(
        "Viewer applies to 1 person. Admin will automatically receive Editor access based on their global role. Access ends when the sandbox is published.",
      ),
    ).toBeTruthy();

    const accessLevel = within(dialog).getByLabelText("Access level");
    fireEvent.click(accessLevel);
    expect(
      (await screen.findByRole("option", { name: "Editor" })).getAttribute(
        "aria-disabled",
      ),
    ).toBe("true");
    fireEvent.click(await screen.findByRole("option", { name: "Viewer" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Invite" }));
    await waitFor(() => expect(sharing.grantSandboxAccess).toHaveBeenCalledTimes(2));
    expect(sharing.grantSandboxAccess).toHaveBeenNthCalledWith(
      1,
      sandbox.treeId,
      "viewer-1",
      "viewer",
    );
    expect(sharing.grantSandboxAccess).toHaveBeenNthCalledWith(
      2,
      sandbox.treeId,
      "admin-1",
      "viewer",
    );
    await waitFor(() =>
      expect(
        within(dialog).queryByRole("button", { name: "Remove Morgan Fixture" }),
      ).toBeNull(),
    );
    sharing.grantSandboxAccess.mockClear();

    fireEvent.change(input, { target: { value: "morgan" } });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Morgan Fixture/ }),
    );
    fireEvent.change(input, { target: { value: "jordan" } });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Jordan Fixture/ }),
    );
    expect(within(dialog).getByLabelText("Access level").textContent).toBe("Viewer");

    fireEvent.click(within(dialog).getByRole("button", { name: "Invite" }));
    await waitFor(() => expect(sharing.grantSandboxAccess).toHaveBeenCalledTimes(2));
    expect(sharing.grantSandboxAccess).toHaveBeenNthCalledWith(
      1,
      sandbox.treeId,
      "viewer-1",
      "viewer",
    );
    expect(sharing.grantSandboxAccess).toHaveBeenNthCalledWith(
      2,
      sandbox.treeId,
      "admin-1",
      "viewer",
    );
  });

  it("resets the hidden assigned level before an elevated-only invitation", async () => {
    sharing.getSandboxShareDetails.mockResolvedValue({
      treeId: sandbox.treeId,
      name: sandbox.name,
      ownerName: "Owner",
      ownerEmail: "owner@example.com",
      archived: false,
      canManage: true,
      shares: [],
      recipients: [
        {
          authId: "viewer-1",
          name: "Morgan Fixture",
          email: "morgan@example.com",
          role: "editor",
        },
        {
          authId: "admin-1",
          name: "Jordan Fixture",
          email: "jordan@example.com",
          role: "admin",
        },
      ],
    });
    sharing.grantSandboxAccess.mockResolvedValue({ ok: true });
    render(providers(<SandboxList sandboxes={[sandbox]} />));

    fireEvent.click(screen.getByRole("button", { name: "Share Finance restructure" }));
    let dialog = screen.getByRole("dialog", { name: "Share sandbox" });
    let input = await within(dialog).findByRole("combobox", { name: "Add people" });
    fireEvent.change(input, { target: { value: "morgan" } });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Morgan Fixture/ }),
    );
    fireEvent.click(within(dialog).getByLabelText("Access level"));
    fireEvent.click(await screen.findByRole("option", { name: "Editor" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Share Finance restructure" }));
    dialog = screen.getByRole("dialog", { name: "Share sandbox" });
    input = await within(dialog).findByRole("combobox", { name: "Add people" });
    fireEvent.change(input, { target: { value: "jordan" } });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Jordan Fixture/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Invite" }));

    await waitFor(() =>
      expect(sharing.grantSandboxAccess).toHaveBeenCalledWith(
        sandbox.treeId,
        "admin-1",
        "viewer",
      ),
    );
  });

  it("clears an Editor assignment when only an elevated recipient remains", async () => {
    sharing.getSandboxShareDetails.mockResolvedValue({
      treeId: sandbox.treeId,
      name: sandbox.name,
      ownerName: "Owner",
      ownerEmail: "owner@example.com",
      archived: false,
      canManage: true,
      shares: [],
      recipients: [
        {
          authId: "viewer-1",
          name: "Morgan Fixture",
          email: "morgan@example.com",
          role: "editor",
        },
        {
          authId: "admin-1",
          name: "Jordan Fixture",
          email: "jordan@example.com",
          role: "admin",
        },
      ],
    });
    sharing.grantSandboxAccess.mockResolvedValue({ ok: true });
    render(providers(<SandboxList sandboxes={[sandbox]} />));

    fireEvent.click(screen.getByRole("button", { name: "Share Finance restructure" }));
    const dialog = screen.getByRole("dialog", { name: "Share sandbox" });
    const input = await within(dialog).findByRole("combobox", { name: "Add people" });

    fireEvent.change(input, { target: { value: "morgan" } });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Morgan Fixture/ }),
    );
    fireEvent.click(within(dialog).getByLabelText("Access level"));
    fireEvent.click(await screen.findByRole("option", { name: "Editor" }));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove Morgan Fixture" }),
    );
    expect(within(dialog).getByLabelText("Access level").textContent).toBe("Viewer");

    fireEvent.change(input, { target: { value: "jordan" } });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Jordan Fixture/ }),
    );
    expect(within(dialog).queryByRole("combobox", { name: "Access level" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Invite" }));

    await waitFor(() =>
      expect(sharing.grantSandboxAccess).toHaveBeenCalledWith(
        sandbox.treeId,
        "admin-1",
        "viewer",
      ),
    );
  });

  it("clears an Editor assignment when only an elevated invitation fails", async () => {
    sharing.getSandboxShareDetails.mockResolvedValue({
      treeId: sandbox.treeId,
      name: sandbox.name,
      ownerName: "Owner",
      ownerEmail: "owner@example.com",
      archived: false,
      canManage: true,
      shares: [],
      recipients: [
        {
          authId: "viewer-1",
          name: "Morgan Fixture",
          email: "morgan@example.com",
          role: "editor",
        },
        {
          authId: "admin-1",
          name: "Jordan Fixture",
          email: "jordan@example.com",
          role: "admin",
        },
      ],
    });
    sharing.grantSandboxAccess.mockImplementation(async (_treeId, authId) =>
      authId === "admin-1" ? { ok: false, reason: "Invite failed" } : { ok: true },
    );
    render(providers(<SandboxList sandboxes={[sandbox]} />));

    fireEvent.click(screen.getByRole("button", { name: "Share Finance restructure" }));
    const dialog = screen.getByRole("dialog", { name: "Share sandbox" });
    const input = await within(dialog).findByRole("combobox", { name: "Add people" });

    fireEvent.change(input, { target: { value: "morgan" } });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Morgan Fixture/ }),
    );
    fireEvent.change(input, { target: { value: "jordan" } });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Jordan Fixture/ }),
    );
    fireEvent.click(within(dialog).getByLabelText("Access level"));
    fireEvent.click(await screen.findByRole("option", { name: "Editor" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Invite" }));
    await waitFor(() => expect(sharing.grantSandboxAccess).toHaveBeenCalledTimes(2));
    expect(within(dialog).queryByRole("combobox", { name: "Access level" })).toBeNull();

    fireEvent.change(input, { target: { value: "morgan" } });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Morgan Fixture/ }),
    );
    expect(within(dialog).getByLabelText("Access level").textContent).toBe("Viewer");
  });

  it("locks the invitation composer while an invitation is pending", async () => {
    const invitation = deferred<{ ok: true }>();
    sharing.getSandboxShareDetails.mockResolvedValue({
      treeId: sandbox.treeId,
      name: sandbox.name,
      ownerName: "Owner",
      ownerEmail: "owner@example.com",
      archived: false,
      canManage: true,
      shares: [],
      recipients: [
        {
          authId: "viewer-1",
          name: "Morgan Fixture",
          email: "morgan@example.com",
          role: "viewer",
        },
      ],
    });
    sharing.grantSandboxAccess.mockReturnValue(invitation.promise);
    render(providers(<SandboxList sandboxes={[sandbox]} />));

    fireEvent.click(screen.getByRole("button", { name: "Share Finance restructure" }));
    const dialog = screen.getByRole("dialog", { name: "Share sandbox" });
    const input = await within(dialog).findByRole("combobox", { name: "Add people" });
    fireEvent.change(input, { target: { value: "morgan" } });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Morgan Fixture/ }),
    );
    const invite = within(dialog).getByRole("button", { name: "Invite" });
    fireEvent.click(invite);

    await waitFor(() => expect((invite as HTMLButtonElement).disabled).toBe(true));
    expect((input as HTMLInputElement).disabled).toBe(true);
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Remove Morgan Fixture",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        within(dialog).getByRole("combobox", {
          name: "Access level",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    await act(async () => invitation.resolve({ ok: true }));
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
  });

  it("does not keep a new sandbox composer locked by an older invitation", async () => {
    const invitation = deferred<{ ok: true }>();
    const secondSandbox = {
      ...sandbox,
      treeId: "a19deeb7-2d03-42e4-9a1c-d795575e28d7",
      name: "People operations",
    };
    sharing.getSandboxShareDetails.mockImplementation((treeId) =>
      Promise.resolve({
        treeId,
        name: treeId === sandbox.treeId ? sandbox.name : secondSandbox.name,
        ownerName: "Owner",
        ownerEmail: "owner@example.com",
        archived: false,
        canManage: true,
        shares: [],
        recipients:
          treeId === sandbox.treeId
            ? [
                {
                  authId: "viewer-1",
                  name: "Morgan Fixture",
                  email: "morgan@example.com",
                  role: "viewer",
                },
              ]
            : [],
      }),
    );
    sharing.grantSandboxAccess.mockReturnValue(invitation.promise);
    render(providers(<SandboxList sandboxes={[sandbox, secondSandbox]} />));

    fireEvent.click(screen.getByRole("button", { name: "Share Finance restructure" }));
    let dialog = screen.getByRole("dialog", { name: "Share sandbox" });
    let input = await within(dialog).findByRole("combobox", { name: "Add people" });
    fireEvent.change(input, { target: { value: "morgan" } });
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Morgan Fixture/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Invite" }));
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(true));

    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Share People operations" }));
    dialog = screen.getByRole("dialog", { name: "Share sandbox" });
    input = await within(dialog).findByRole("combobox", { name: "Add people" });

    expect((input as HTMLInputElement).disabled).toBe(false);
    await act(async () => invitation.resolve({ ok: true }));
  });

  it("ignores details returned for a previously closed sandbox dialog", async () => {
    const firstDetails =
      deferred<Awaited<ReturnType<typeof sharing.getSandboxShareDetails>>>();
    const secondSandbox = {
      ...sandbox,
      treeId: "a19deeb7-2d03-42e4-9a1c-d795575e28d7",
      name: "People operations",
    };
    sharing.getSandboxShareDetails.mockImplementation((treeId) => {
      if (treeId === sandbox.treeId) return firstDetails.promise;
      return Promise.resolve({
        treeId: secondSandbox.treeId,
        name: secondSandbox.name,
        ownerName: "Owner",
        ownerEmail: "owner@example.com",
        archived: false,
        canManage: true,
        shares: [],
        recipients: [
          {
            authId: "current-viewer",
            name: "Current Viewer",
            email: "current@example.com",
            role: "viewer",
          },
        ],
      });
    });
    render(providers(<SandboxList sandboxes={[sandbox, secondSandbox]} />));

    fireEvent.click(screen.getByRole("button", { name: "Share Finance restructure" }));
    let dialog = screen.getByRole("dialog", { name: "Share sandbox" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Share People operations" }));
    dialog = screen.getByRole("dialog", { name: "Share sandbox" });
    const input = await within(dialog).findByRole("combobox", { name: "Add people" });

    await act(async () =>
      firstDetails.resolve({
        treeId: sandbox.treeId,
        name: sandbox.name,
        ownerName: "Owner",
        ownerEmail: "owner@example.com",
        archived: false,
        canManage: true,
        shares: [],
        recipients: [
          {
            authId: "stale-viewer",
            name: "Stale Viewer",
            email: "stale@example.com",
            role: "viewer",
          },
        ],
      }),
    );
    fireEvent.change(input, { target: { value: "current" } });

    expect(
      await within(dialog).findByRole("button", { name: /Current Viewer/ }),
    ).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /Stale Viewer/ })).toBeNull();
  });

  it("filters the loaded catalog immediately and shows identity context", async () => {
    sharing.getSandboxShareDetails.mockResolvedValue({
      treeId: sandbox.treeId,
      name: sandbox.name,
      ownerName: "Owner",
      ownerEmail: "owner@example.com",
      archived: false,
      canManage: true,
      shares: [],
      recipients: [
        {
          authId: "person-quinn",
          name: "Quinn Fixture",
          email: "quinn.fixture@example.com",
          role: "viewer",
          jobTitle: "Risk analyst",
          officeLocation: "Kuala Lumpur",
        },
      ],
    });
    render(providers(<SandboxList sandboxes={[sandbox]} />));

    fireEvent.click(screen.getByRole("button", { name: "Share Finance restructure" }));
    const dialog = screen.getByRole("dialog", { name: "Share sandbox" });
    const input = await within(dialog).findByRole("combobox", { name: "Add people" });

    fireEvent.change(input, { target: { value: "quinn" } });
    expect(await within(dialog).findByText("quinn.fixture@example.com")).toBeTruthy();
    expect(within(dialog).getByText("Risk analyst · Kuala Lumpur")).toBeTruthy();

    fireEvent.change(input, { target: { value: "nobody" } });
    expect(within(dialog).queryByText("quinn.fixture@example.com")).toBeNull();
    expect(within(dialog).queryByText("Searching…")).toBeNull();
    expect(within(dialog).getByText("No matching people.")).toBeTruthy();
    expect(
      document.getElementById("sandbox-share-search-results")?.className,
    ).not.toContain("border");
  });

  it("shows Shared with me below the user’s sandbox section", () => {
    render(providers(<SandboxList sandboxes={[sandbox]} />));

    expect(screen.getByRole("heading", { name: "My sandboxes (1)" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Shared with me (0)" })).toBeTruthy();
    expect(screen.getByText("No shared sandboxes.")).toBeTruthy();
    expect(screen.queryByText("Sharing is coming next")).toBeNull();
    expect(screen.getByRole("button", { name: /Active/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Archived/ })).toBeTruthy();
    expect(screen.getByText("Finance restructure")).toBeTruthy();
    expect(document.querySelector('[data-slot="separator"]')).toBeTruthy();
  });

  it("does not suggest sandbox creation to a Viewer", () => {
    render(providers(<SandboxList sandboxes={[]} />, "viewer"));

    expect(screen.getByText("No personal sandboxes")).toBeTruthy();
    expect(
      screen.getByText("You can open sandboxes shared with you below."),
    ).toBeTruthy();
    expect(
      screen.queryByText("Create a sandbox to edit the chart without publishing."),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Create sandbox" })).toBeNull();
  });

  it("keeps shared sandboxes when returning while the list cache is fresh", async () => {
    const shared = {
      ...sandbox,
      treeId: "shared-sandbox-1",
      name: "Shared finance plan",
      ownerAuthId: "owner-2",
      ownerName: "Another Owner",
      accessLevel: "viewer" as const,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ owned: [sandbox], shared: [shared] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(providers(<SandboxList />));
    expect(await screen.findByText("Shared finance plan")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    cleanup();
    render(providers(<SandboxList />));

    expect(screen.getByText("Shared finance plan")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses one primary action row and an overflow menu for owner actions", async () => {
    render(providers(<SandboxList sandboxes={[sandbox]} />));

    const open = screen.getByRole("button", { name: "Open sandbox" });
    expect(open.getAttribute("data-variant")).toBe("default");
    expect(
      screen.getByRole("button", { name: "Share Finance restructure" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Delete Finance restructure/ }),
    ).toBeNull();

    const moreActions = screen.getByRole("button", {
      name: "More actions for Finance restructure",
    });
    moreActions.focus();
    fireEvent.keyDown(moreActions, { key: "Enter" });

    expect(await screen.findByRole("menuitem", { name: "Archive" })).toBeTruthy();
    const deleteItem = screen.getByRole("menuitem", { name: "Delete" });
    expect(deleteItem.getAttribute("data-variant")).toBe("destructive");
  });

  it.each(["editor", "publisher", "admin"] as const)(
    "shows sharing controls to a %s who owns the sandbox",
    (role) => {
      render(providers(<SandboxList sandboxes={[sandbox]} />, role));

      expect(
        screen.getByRole("button", { name: "Share Finance restructure" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "More actions for Finance restructure" }),
      ).toBeTruthy();
    },
  );

  it("defaults sandbox oversight to owned rows and filters all rows by search", () => {
    render(providers(<SandboxAccessList rows={accessRows} />));

    expect(
      screen.getByRole("tab", { name: "My sandboxes" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByText("Finance restructure")).toBeTruthy();
    expect(screen.queryByText("People operations")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "All sandboxes" }));
    expect(screen.getByText("People operations")).toBeTruthy();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search sandboxes by name or owner" }),
      { target: { value: "another owner" } },
    );
    expect(screen.queryByText("Finance restructure")).toBeNull();
    expect(screen.getByText("People operations")).toBeTruthy();

    const manageAccess = screen.getByRole("button", {
      name: "Manage access for People operations",
    });
    expect(manageAccess.textContent).toContain("Manage access");
    fireEvent.click(manageAccess);
    expect(screen.getByRole("dialog", { name: "Share sandbox" })).toBeTruthy();
  });

  it("shows revoked and expired grants in editable organization oversight", async () => {
    sharing.getSandboxShareDetails.mockResolvedValue({
      treeId: sandbox.treeId,
      name: sandbox.name,
      ownerName: "Owner",
      ownerEmail: "owner@example.com",
      archived: false,
      canManage: true,
      shares: [
        {
          shareId: "revoked-share",
          authId: "former-viewer",
          name: "Former Viewer",
          email: "former.viewer@example.com",
          role: "viewer",
          accessLevel: "viewer",
          grantedAt: "2026-09-20T00:00:00.000Z",
          status: "revoked",
        },
        {
          shareId: "expired-share",
          authId: "former-editor",
          name: "Former Editor",
          email: "former.editor@example.com",
          role: "editor",
          accessLevel: "editor",
          grantedAt: "2026-09-19T00:00:00.000Z",
          status: "expired",
        },
      ],
      recipients: [],
    });
    render(providers(<SandboxAccessList rows={accessRows} />));

    fireEvent.click(
      screen.getByRole("button", { name: "Manage access for Finance restructure" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Share sandbox" });

    expect(await within(dialog).findByText("Past access")).toBeTruthy();
    expect(within(dialog).getByText("Former Viewer")).toBeTruthy();
    expect(within(dialog).getByText("Former Editor")).toBeTruthy();
    expect(within(dialog).getByRole("combobox", { name: "Add people" })).toBeTruthy();
  });

  it("renders and searches oversight rows whose owner name is missing", () => {
    const unnamedOwnerRows = [
      {
        ...accessRows[0]!,
        ownerName: null as unknown as string,
      },
    ];
    render(providers(<SandboxAccessList rows={unnamedOwnerRows} />));

    expect(screen.getByText("Unknown owner")).toBeTruthy();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search sandboxes by name or owner" }),
      { target: { value: "unknown owner" } },
    );
    expect(screen.getByText("Finance restructure")).toBeTruthy();
  });
});
