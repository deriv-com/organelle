import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { GlobalDrawer } from "@/components/global-drawer";
import { Providers } from "@/components/providers";
import { AuthProvider } from "@/features/auth/auth-provider";
import { canAccessPath } from "@/features/auth/nav";
import { EDITOR_ROLES, hasAllowedRole } from "@/features/auth/policy";
import { getActor } from "@/features/auth/session";
import { hasSandboxWorkspaceAccess } from "@/features/sandbox/access";

import "./globals.css";

import type { Metadata } from "next";

const organizationName = process.env.ORG_NAME?.trim() || "Organelle";

export const metadata: Metadata = {
  title: organizationName,
  description: "Org chart and directory",
  icons: {
    icon: [{ url: "/icon.png", type: "image/png" }],
    apple: "/icon.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body
        className="h-full overflow-hidden bg-background text-foreground antialiased"
        suppressHydrationWarning
      >
        <Providers>
          <AuthGate>{children}</AuthGate>
        </Providers>
      </body>
    </html>
  );
}

async function AuthGate({ children }: { children: ReactNode }) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  const publicPath = pathname === "/login" || pathname === "/api/health";
  if (publicPath) return <>{children}</>;

  const result = await getActor();
  if (!result.ok) {
    if (result.code === "wrong_domain") redirect("/login?error=domain");
    if (result.code === "unauthenticated") redirect("/login");
    if (pathname !== "/not-in-directory") redirect("/not-in-directory");
    return (
      <AuthProvider actor={null}>
        <div className="flex h-full flex-col">
          <AppHeader organizationName={organizationName} />
          <div className="min-h-0 flex-1 overflow-auto bg-canvas">{children}</div>
        </div>
      </AuthProvider>
    );
  }

  if (pathname === "/not-in-directory") redirect("/chart");
  const hasSandboxAccess = hasAllowedRole(result.actor.role, EDITOR_ROLES)
    ? false
    : await hasSandboxWorkspaceAccess(result.actor);
  if (!canAccessPath(result.actor.role, pathname, hasSandboxAccess)) {
    if (/^\/sandbox\/[^/]+\/merge$/.test(pathname)) {
      redirect(pathname.replace(/\/merge$/, ""));
    }
    redirect("/chart");
  }

  return (
    <AuthProvider actor={result.actor}>
      <div className="flex h-full flex-col">
        <AppHeader
          hasSandboxAccess={hasSandboxAccess}
          organizationName={organizationName}
        />
        <div className="min-h-0 flex-1 overflow-auto bg-canvas">{children}</div>
      </div>
      <Suspense>
        <GlobalDrawer />
      </Suspense>
    </AuthProvider>
  );
}
