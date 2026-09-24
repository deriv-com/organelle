"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { Actor } from "./policy";
import {
  ADMIN_ROLES,
  DIRECTORY_STATUS_ROLES,
  EDITOR_ROLES,
  EXPORT_ROLES,
  MERGE_ROLES,
  RESTORE_ROLES,
  hasAllowedRole,
} from "./policy";

const AuthContext = createContext<Actor | null>(null);

export function AuthProvider({
  actor,
  children,
}: {
  actor: Actor | null;
  children: ReactNode;
}) {
  return <AuthContext.Provider value={actor}>{children}</AuthContext.Provider>;
}

export function useActor(): Actor | null {
  return useContext(AuthContext);
}

export function useCanEdit(): boolean {
  const actor = useActor();
  return Boolean(actor && hasAllowedRole(actor.role, EDITOR_ROLES));
}

export function useCanMerge(): boolean {
  const actor = useActor();
  return Boolean(actor && hasAllowedRole(actor.role, MERGE_ROLES));
}

export function useCanSeeDirectoryStatus(): boolean {
  const actor = useActor();
  return Boolean(actor && hasAllowedRole(actor.role, DIRECTORY_STATUS_ROLES));
}

export function useCanExport(): boolean {
  const actor = useActor();
  return Boolean(actor && hasAllowedRole(actor.role, EXPORT_ROLES));
}

export function useIsAdmin(): boolean {
  const actor = useActor();
  return Boolean(actor && hasAllowedRole(actor.role, ADMIN_ROLES));
}

export function useCanRestore(): boolean {
  const actor = useActor();
  return Boolean(actor && hasAllowedRole(actor.role, RESTORE_ROLES));
}
