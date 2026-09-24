/**
 * Session → employee → role. AUTH_DEV_EMAIL is development-only.
 */

import { cache } from "react";
import { getServerSession } from "next-auth";

import { withDbRetry } from "@/lib/db";
import { authOptions } from "./options";
import {
  type Actor,
  type ActorLookup,
  type ActorResult,
  type AppRole,
  emailDomainOk,
  hasAllowedRole,
  resolveActorFromEmail,
  statusForActorFailure,
} from "./policy";

export type { Actor, ActorResult, AppRole } from "./policy";
export {
  ADMIN_ROLES,
  EDITOR_ROLES,
  EXPORT_ROLES,
  INTEGRATIONS_ROLES,
  MERGE_ROLES,
  SANDBOX_SHARING_ROLES,
  DIRECTORY_STATUS_ROLES,
  RESTORE_ROLES,
  hasAllowedRole,
  statusForActorFailure,
} from "./policy";

type SessionIdentity = {
  email: string;
  issuer?: string;
  subject?: string;
  development: boolean;
};

export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  if (process.env.NODE_ENV === "development") {
    const dev = process.env.AUTH_DEV_EMAIL?.trim();
    if (dev) return { email: dev.toLowerCase(), development: true };
  }

  const session = await getServerSession(authOptions);
  const user = session?.user;
  const email = user?.email?.trim().toLowerCase();
  if (!email) return null;
  if (!user?.oidcIssuer || !user.oidcSubject) return null;
  return {
    email,
    issuer: user.oidcIssuer,
    subject: user.oidcSubject,
    development: false,
  };
}

export async function getSessionEmail(): Promise<string | null> {
  return (await getSessionIdentity())?.email ?? null;
}

async function lookupEmployee(identity: SessionIdentity): Promise<ActorLookup | null> {
  return withDbRetry(async (sql) => {
    return sql.begin(async (tx) => {
      if (!identity.development && identity.issuer && identity.subject) {
        const bound = await tx<
          { auth_id: string; full_name: string; role: AppRole | null }[]
        >`
          select e.auth_id, e.full_name, r.role
          from organelle.oidc_identities i
          join organelle.employees e on e.auth_id = i.employee_auth_id
          left join organelle.app_roles r on r.auth_id = e.auth_id
          where i.issuer = ${identity.issuer} and i.subject = ${identity.subject}
            and e.sandbox_tree_id is null
        `;
        if (bound[0]) {
          return {
            authId: bound[0].auth_id,
            name: bound[0].full_name,
            role: bound[0].role,
          };
        }

        const candidates = await tx<{ auth_id: string }[]>`
          select e.auth_id
          from organelle.employees e
          left join organelle.oidc_identities i on i.employee_auth_id = e.auth_id
          where lower(e.email) = ${identity.email}
            and e.sandbox_tree_id is null
            and i.employee_auth_id is null
          for update of e
        `;
        if (candidates.length !== 1) return null;
        const inserted = await tx<{ employee_auth_id: string }[]>`
          insert into organelle.oidc_identities (employee_auth_id, issuer, subject)
          values (${candidates[0]!.auth_id}, ${identity.issuer}, ${identity.subject})
          on conflict do nothing
          returning employee_auth_id
        `;
        if (inserted.length !== 1) return null;
      }

      const rows = await tx<
        { auth_id: string; full_name: string; role: AppRole | null }[]
      >`
        select e.auth_id, e.full_name, r.role
        from organelle.employees e
        left join organelle.app_roles r on r.auth_id = e.auth_id
        ${
          identity.development
            ? tx`where lower(e.email) = ${identity.email} and e.sandbox_tree_id is null`
            : tx`join organelle.oidc_identities i on i.employee_auth_id = e.auth_id
                 where i.issuer = ${identity.issuer!} and i.subject = ${identity.subject!}`
        }
      `;
      const row = rows[0];
      return row ? { authId: row.auth_id, name: row.full_name, role: row.role } : null;
    });
  });
}

export const getActor = cache(async function getActor(): Promise<ActorResult> {
  const identity = await getSessionIdentity();
  if (!identity) {
    return { ok: false, code: "unauthenticated", reason: "Sign in required" };
  }
  if (!emailDomainOk(identity.email)) {
    return resolveActorFromEmail(identity.email, null);
  }
  const lookup = await lookupEmployee(identity);
  return resolveActorFromEmail(identity.email, lookup);
});

export async function requireActor(): Promise<
  { ok: true; actor: Actor } | { ok: false; status: 401 | 403 }
> {
  const result = await getActor();
  if (result.ok) return result;
  return { ok: false, status: statusForActorFailure(result.code) };
}

export function jsonNotAllowed(status: 401 | 403): Response {
  return Response.json({ error: "Not allowed" }, { status });
}

export function textNotAllowed(status: 401 | 403): Response {
  return new Response("Not allowed", { status });
}

export async function requireRole(
  allowed: readonly AppRole[],
): Promise<
  { ok: true; actor: Actor } | { ok: false; reason: string; status: 401 | 403 }
> {
  const result = await getActor();
  if (!result.ok) {
    return {
      ok: false,
      reason: "Not allowed",
      status: statusForActorFailure(result.code),
    };
  }
  if (!hasAllowedRole(result.actor.role, allowed)) {
    return { ok: false, reason: "Not allowed", status: 403 };
  }
  return { ok: true, actor: result.actor };
}
