import Image from "next/image";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

import { oidcConfigured } from "@/features/auth/options";
import { allowedEmailDomains } from "@/features/auth/policy";
import { SignInButton, SignOutButton } from "@/features/auth/session-buttons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const organizationName = process.env.ORG_NAME?.trim() || "Organelle";
  const { error } = await searchParams;
  const accessReady = oidcConfigured();
  const providerName = process.env.OIDC_PROVIDER_NAME?.trim() || "OpenID Connect";
  const domains = allowedEmailDomains();
  const devEmail =
    process.env.NODE_ENV === "development"
      ? process.env.AUTH_DEV_EMAIL?.trim()
      : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-border/70 bg-background p-6 shadow-xs">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex items-center gap-2.5">
              <Image
                src="/icon.png"
                alt=""
                width={24}
                height={24}
                className="size-6 object-contain"
              />
              <span className="text-sm font-bold tracking-tight">
                {organizationName}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Sign in through your organization&apos;s identity provider.
            </p>
          </div>

          {error === "domain" ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Wrong account domain</AlertTitle>
              <AlertDescription>
                Use an account from{" "}
                {domains.length ? domains.join(", ") : "an allowed domain"}.
              </AlertDescription>
            </Alert>
          ) : null}

          {devEmail ? (
            <div className="flex flex-col gap-4 rounded-lg border border-border/70 bg-muted/40 p-4">
              <div className="flex flex-col gap-2">
                <Badge variant="secondary" className="w-fit">
                  Development
                </Badge>
                <p className="text-sm text-muted-foreground">
                  Signed in locally as{" "}
                  <span className="font-medium text-foreground">{devEmail}</span>.
                </p>
              </div>
              <Button asChild className="w-full">
                <Link href="/chart">Open chart</Link>
              </Button>
            </div>
          ) : accessReady ? (
            <SignInButton providerName={providerName} />
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              OIDC is not configured. Set OIDC_ISSUER, OIDC_CLIENT_ID,
              OIDC_CLIENT_SECRET, and AUTH_SECRET, or use AUTH_DEV_EMAIL in development.
            </p>
          )}

          {(error === "domain" || accessReady) && !devEmail ? (
            <div className="flex justify-center">
              <SignOutButton />
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
