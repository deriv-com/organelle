"use client";

import { signIn, signOut } from "next-auth/react";

import { Button } from "@/components/ui/button";

export function SignInButton({ providerName }: { providerName: string }) {
  return (
    <Button
      className="w-full"
      onClick={() => void signIn("oidc", { callbackUrl: "/chart" })}
    >
      Sign in with {providerName}
    </Button>
  );
}

export function SignOutButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void signOut({ callbackUrl: "/login" })}
    >
      Sign out
    </Button>
  );
}
