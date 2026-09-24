import { describe, expect, it } from "vitest";

import { effectiveSandboxShareLevel, resolveSandboxAccess } from "./access";

const viewer = {
  authId: "viewer-id",
  email: "viewer@example.com",
  name: "Viewer",
  role: "viewer" as const,
};

describe("sandbox-scoped access", () => {
  it.each(["publisher", "admin"] as const)(
    "derives Editor access for a shared %s",
    (role) => {
      expect(effectiveSandboxShareLevel(role, "viewer")).toBe("editor");
      expect(effectiveSandboxShareLevel(role, "editor")).toBe("editor");
    },
  );

  it("recomputes effective access from the current role without changing the assigned grant", () => {
    const assignedLevel = "viewer" as const;
    const promoted = resolveSandboxAccess({
      treeId: "s",
      ownerAuthId: "owner-id",
      archived: false,
      shareLevel: assignedLevel,
      actor: { ...viewer, authId: "recipient-id", role: "admin" },
    });
    const demoted = resolveSandboxAccess({
      treeId: "s",
      ownerAuthId: "owner-id",
      archived: false,
      shareLevel: assignedLevel,
      actor: { ...viewer, authId: "recipient-id", role: "viewer" },
    });

    expect(promoted.shareLevel).toBe("editor");
    expect(promoted.canEdit).toBe(true);
    expect(demoted.shareLevel).toBe("viewer");
    expect(demoted.canEdit).toBe(false);
    expect(assignedLevel).toBe("viewer");
  });

  it("caps an Editor grant at read-only access for a global Viewer", () => {
    const granted = resolveSandboxAccess({
      treeId: "sandbox-a",
      ownerAuthId: "owner-id",
      archived: false,
      shareLevel: "editor",
      actor: viewer,
    });
    const other = resolveSandboxAccess({
      treeId: "sandbox-b",
      ownerAuthId: "owner-id",
      archived: false,
      shareLevel: null,
      actor: viewer,
    });

    expect(granted.canView).toBe(true);
    expect(granted.shareLevel).toBe("viewer");
    expect(granted.canEdit).toBe(false);
    expect(granted.canPublish).toBe(false);
    expect(granted.canManageSharing).toBe(false);
    expect(other.canView).toBe(false);
    expect(other.canEdit).toBe(false);
  });

  it("keeps Viewer grants read-only and makes archived sandboxes read-only", () => {
    expect(
      resolveSandboxAccess({
        treeId: "sandbox-a",
        ownerAuthId: "owner-id",
        archived: false,
        shareLevel: "viewer",
        actor: viewer,
      }).canEdit,
    ).toBe(false);
    expect(
      resolveSandboxAccess({
        treeId: "sandbox-a",
        ownerAuthId: "owner-id",
        archived: true,
        shareLevel: "editor",
        actor: viewer,
      }).canEdit,
    ).toBe(false);
  });

  it("limits publishing to publishers and admins with access", () => {
    const owner = { ...viewer, authId: "owner-id", role: "editor" as const };
    const hr = { ...viewer, authId: "hr-id", role: "publisher" as const };
    const hrOwner = { ...hr, authId: "owner-id" };
    expect(
      resolveSandboxAccess({
        treeId: "s",
        ownerAuthId: "owner-id",
        archived: false,
        shareLevel: null,
        actor: owner,
      }).canPublish,
    ).toBe(false);
    expect(
      resolveSandboxAccess({
        treeId: "s",
        ownerAuthId: "owner-id",
        archived: false,
        shareLevel: null,
        actor: hrOwner,
      }).canPublish,
    ).toBe(true);
    expect(
      resolveSandboxAccess({
        treeId: "s",
        ownerAuthId: "owner-id",
        archived: false,
        shareLevel: "viewer",
        actor: hr,
      }).canPublish,
    ).toBe(true);
    expect(
      resolveSandboxAccess({
        treeId: "s",
        ownerAuthId: "owner-id",
        archived: false,
        shareLevel: "editor",
        actor: viewer,
      }).canPublish,
    ).toBe(false);
  });

  it.each(["viewer", "developer"] as const)(
    "revokes owner workspace rights after demotion to %s",
    (role) => {
      const access = resolveSandboxAccess({
        treeId: "s",
        ownerAuthId: "owner-id",
        archived: false,
        shareLevel: null,
        actor: { ...viewer, authId: "owner-id", role },
      });

      expect(access).toMatchObject({
        isOwner: true,
        canView: false,
        canEdit: false,
        canPublish: false,
        canManageLifecycle: false,
        canReadHistory: false,
      });
    },
  );

  it.each(["editor", "publisher", "admin"] as const)(
    "rejects a non-owner %s after their grant is removed",
    (role) => {
      const actor = { ...viewer, authId: `${role}-id`, role };
      const access = resolveSandboxAccess({
        treeId: "s",
        ownerAuthId: "owner-id",
        archived: false,
        shareLevel: null,
        actor,
      });

      expect(access.canView).toBe(false);
      expect(access.canEdit).toBe(false);
      expect(access.canPublish).toBe(false);
    },
  );

  it.each(["publisher", "admin"] as const)(
    "gives a shared %s automatic Editor access",
    (role) => {
      const actor = { ...viewer, authId: `${role}-id`, role };
      const access = resolveSandboxAccess({
        treeId: "s",
        ownerAuthId: "owner-id",
        archived: false,
        shareLevel: "viewer",
        actor,
      });

      expect(access.canView).toBe(true);
      expect(access.shareLevel).toBe("editor");
      expect(access.canEdit).toBe(true);
      expect(access.canPublish).toBe(true);
      expect(access.canReadHistory).toBe(false);
    },
  );

  it("lets owners manage shares and limits organization oversight to admins", () => {
    const owner = { ...viewer, authId: "owner-id", role: "editor" as const };
    const hr = { ...viewer, authId: "hr-id", role: "publisher" as const };
    const admin = { ...viewer, authId: "admin-id", role: "admin" as const };
    const publisher = { ...viewer, authId: "publisher-id", role: "publisher" as const };
    const resolve = (
      actor: typeof owner | typeof hr | typeof admin | typeof publisher,
    ) =>
      resolveSandboxAccess({
        treeId: "s",
        ownerAuthId: "owner-id",
        archived: false,
        shareLevel: null,
        actor,
      }).canManageSharing;

    expect(resolve(owner)).toBe(true);
    expect(resolve({ ...hr, authId: "owner-id" })).toBe(true);
    expect(resolve(hr)).toBe(false);
    expect(resolve(admin)).toBe(true);
    expect(resolve(publisher)).toBe(false);
  });
});
