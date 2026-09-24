import type { NextAuthOptions } from "next-auth";
import type { OAuthConfig } from "next-auth/providers/oauth";

type OidcProfile = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  picture?: string;
};

export function oidcConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.OIDC_ISSUER?.trim() &&
    env.OIDC_CLIENT_ID?.trim() &&
    env.OIDC_CLIENT_SECRET?.trim() &&
    env.AUTH_SECRET?.trim(),
  );
}

export function oidcUserFromProfile(profile: OidcProfile) {
  const email = profile.email?.trim().toLowerCase();
  if (!email) throw new Error("OIDC identity does not include an email claim");
  if (profile.email_verified !== true) {
    throw new Error("OIDC identity does not include a verified email claim");
  }
  if (!profile.sub?.trim()) throw new Error("OIDC identity does not include a subject");
  return {
    id: profile.sub,
    email,
    name: profile.name ?? profile.preferred_username ?? email,
    image: profile.picture ?? null,
  };
}

function oidcProvider(): OAuthConfig<OidcProfile> {
  const issuer = process.env.OIDC_ISSUER!.replace(/\/$/, "");
  return {
    id: "oidc",
    name: process.env.OIDC_PROVIDER_NAME?.trim() || "OpenID Connect",
    type: "oauth",
    wellKnown: `${issuer}/.well-known/openid-configuration`,
    issuer,
    clientId: process.env.OIDC_CLIENT_ID!,
    clientSecret: process.env.OIDC_CLIENT_SECRET!,
    idToken: true,
    checks: ["pkce", "state"],
    authorization: { params: { scope: "openid email profile" } },
    profile: oidcUserFromProfile,
  };
}

export const authOptions: NextAuthOptions = {
  providers: oidcConfigured() ? [oidcProvider()] : [],
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async jwt({ token, account }) {
      if (account?.provider === "oidc" && account.providerAccountId) {
        token.oidcIssuer = process.env.OIDC_ISSUER?.trim().replace(/\/$/, "");
        token.oidcSubject = account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.email === "string") {
        session.user.email = token.email.toLowerCase();
      }
      if (session.user) {
        session.user.oidcIssuer =
          typeof token.oidcIssuer === "string" ? token.oidcIssuer : undefined;
        session.user.oidcSubject =
          typeof token.oidcSubject === "string" ? token.oidcSubject : undefined;
      }
      return session;
    },
  },
};
