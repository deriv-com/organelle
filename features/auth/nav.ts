/**
 * Role-filtered nav and route gates. UI convenience only —
 * server requireRole is the real enforcement.
 */

import type { AppRole } from "./policy";
import {
  ADMIN_ROLES,
  EDITOR_ROLES,
  EXPORT_ROLES,
  INTEGRATIONS_ROLES,
  RESTORE_ROLES,
  SANDBOX_SHARING_ROLES,
  hasAllowedRole,
} from "./policy";

export type NavHref =
  | "/chart"
  | "/directory"
  | "/sandboxes"
  | "/sandbox-access"
  | "/versions"
  | "/audit"
  | "/integrations"
  | "/admin/roles";

export type NavItem = {
  href: NavHref;
  label: string;
};

const ALL_NAV: Array<
  NavItem & { show: (role: AppRole, hasSandboxAccess: boolean) => boolean }
> = [
  { href: "/chart", label: "Functional chart", show: () => true },
  { href: "/directory", label: "Directory", show: () => true },
  {
    href: "/sandboxes",
    label: "Sandboxes",
    show: (role, hasSandboxAccess) =>
      hasSandboxAccess || hasAllowedRole(role, EDITOR_ROLES),
  },
  {
    href: "/sandbox-access",
    label: "Sandbox access",
    show: (role) => hasAllowedRole(role, SANDBOX_SHARING_ROLES),
  },
  {
    href: "/versions",
    label: "Versions",
    show: (role) => hasAllowedRole(role, RESTORE_ROLES),
  },
  {
    href: "/audit",
    label: "Audit",
    show: (role) => hasAllowedRole(role, ADMIN_ROLES),
  },
  {
    href: "/integrations",
    label: "Integrations",
    show: (role) => hasAllowedRole(role, INTEGRATIONS_ROLES),
  },
  {
    href: "/admin/roles",
    label: "Users",
    show: (role) => hasAllowedRole(role, ADMIN_ROLES),
  },
];

export function navItemsForRole(role: AppRole, hasSandboxAccess = false): NavItem[] {
  return ALL_NAV.filter((item) => item.show(role, hasSandboxAccess)).map(
    ({ href, label }) => ({ href, label }),
  );
}

export function isNavActive(pathname: string, href: NavHref): boolean {
  if (href === "/chart") return pathname === "/chart" || pathname.startsWith("/chart/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** True when the role may stay on this path. Wrong-role URLs redirect to /chart. */
export function canAccessPath(
  role: AppRole,
  pathname: string,
  hasSandboxAccess = false,
): boolean {
  if (pathname.startsWith("/admin")) return hasAllowedRole(role, ADMIN_ROLES);
  if (pathname.startsWith("/audit")) return hasAllowedRole(role, ADMIN_ROLES);
  if (pathname.startsWith("/integrations")) {
    return hasAllowedRole(role, INTEGRATIONS_ROLES);
  }
  if (pathname.startsWith("/versions")) return hasAllowedRole(role, RESTORE_ROLES);
  if (pathname.startsWith("/changes")) return hasAllowedRole(role, EXPORT_ROLES);
  if (pathname.startsWith("/sandbox-access")) {
    return hasAllowedRole(role, SANDBOX_SHARING_ROLES);
  }
  if (/^\/sandbox\/[^/]+\/merge$/.test(pathname)) {
    return hasSandboxAccess || hasAllowedRole(role, EDITOR_ROLES);
  }
  if (/^\/sandbox\/[^/]+\/sync$/.test(pathname)) {
    return hasAllowedRole(role, EDITOR_ROLES);
  }
  // The page/action performs the resource-scoped check after this coarse gate.
  if (pathname === "/sandboxes" || pathname.startsWith("/sandbox/")) {
    return hasSandboxAccess || hasAllowedRole(role, EDITOR_ROLES);
  }
  return true;
}
