export type AppRole = "viewer" | "developer" | "editor" | "publisher" | "admin";

export const APP_ROLES: readonly AppRole[] = [
  "viewer",
  "developer",
  "editor",
  "publisher",
  "admin",
];

export type Actor = {
  authId: string;
  email: string;
  name: string;
  role: AppRole;
};

export const EDITOR_ROLES: readonly AppRole[] = ["editor", "publisher", "admin"];
export const MERGE_ROLES: readonly AppRole[] = ["publisher", "admin"];
/** Organization-wide sandbox-access oversight. Owners manage their own shares. */
export const SANDBOX_SHARING_ROLES: readonly AppRole[] = ["admin"];
export const DIRECTORY_STATUS_ROLES: readonly AppRole[] = MERGE_ROLES;
export const EXPORT_ROLES: readonly AppRole[] = MERGE_ROLES;
export const ADMIN_ROLES: readonly AppRole[] = ["admin"];
export const RESTORE_ROLES: readonly AppRole[] = ["publisher", "admin"];
export const INTEGRATIONS_ROLES: readonly AppRole[] = ["admin"];

export const ROLE_LABEL: Record<AppRole, string> = {
  viewer: "Viewer",
  developer: "Developer",
  editor: "Editor",
  publisher: "Publisher",
  admin: "Admin",
};

export function roleLabel(role: AppRole): string {
  return ROLE_LABEL[role];
}

export type ActorLookup = {
  authId: string;
  name: string;
  role: AppRole | null;
};

export type ActorResult =
  | { ok: true; actor: Actor }
  | {
      ok: false;
      code: "unauthenticated" | "wrong_domain" | "not_in_directory";
      reason: string;
    };

export function allowedEmailDomains(
  value = process.env.ALLOWED_EMAIL_DOMAINS ?? "",
): string[] {
  return value
    .split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function emailDomainOk(email: string): boolean {
  const domains = allowedEmailDomains();
  if (domains.length === 0) return true;
  const domain = email.trim().toLowerCase().split("@").at(-1) ?? "";
  return domains.includes(domain);
}

export function hasAllowedRole(role: AppRole, allowed: readonly AppRole[]): boolean {
  return allowed.includes(role);
}

export function statusForActorFailure(
  code: "unauthenticated" | "wrong_domain" | "not_in_directory",
): 401 | 403 {
  return code === "unauthenticated" ? 401 : 403;
}

export function resolveActorFromEmail(
  email: string | null,
  lookup: ActorLookup | null,
): ActorResult {
  if (!email) {
    return { ok: false, code: "unauthenticated", reason: "Sign in required" };
  }
  const normalised = email.trim().toLowerCase();
  if (!emailDomainOk(normalised)) {
    return {
      ok: false,
      code: "wrong_domain",
      reason: "Use an account from an allowed email domain",
    };
  }
  if (!lookup) {
    return {
      ok: false,
      code: "not_in_directory",
      reason: "Your account isn't in the directory yet",
    };
  }
  return {
    ok: true,
    actor: {
      authId: lookup.authId,
      email: normalised,
      name: lookup.name,
      role: lookup.role ?? "viewer",
    },
  };
}

/** Last remaining admin cannot be demoted or revoked. */
export function canChangeAdminRole(
  adminCount: number,
  targetIsAdmin: boolean,
  nextRole: AppRole,
): boolean {
  if (!targetIsAdmin || nextRole === "admin") return true;
  return adminCount > 1;
}
