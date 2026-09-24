import { EDITOR_ROLES, hasAllowedRole, type AppRole } from "@/features/auth/policy";

export function canReadSandboxHistory(args: {
  kind: string;
  ownerAuthId: string | null;
  actorId: string;
  role: AppRole;
}): boolean {
  return (
    args.kind === "sandbox" &&
    args.ownerAuthId !== null &&
    args.ownerAuthId === args.actorId &&
    hasAllowedRole(args.role, EDITOR_ROLES)
  );
}
