import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

function devBypass(): boolean {
  return process.env.NODE_ENV === "development" && Boolean(process.env.AUTH_DEV_EMAIL);
}

/** Machine v1 routes authenticate with an Organelle API key. */
function integrationsMachineBearer(req: NextRequest, pathname: string): boolean {
  if (!pathname.startsWith("/api/integrations/v1/")) return false;
  const auth = req.headers.get("authorization")?.trim() ?? "";
  return /^Bearer\s+\S+/i.test(auth);
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);

  const publicPath =
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/health" ||
    pathname === "/favicon.ico";

  const sessionToken =
    publicPath || devBypass()
      ? null
      : await getToken({
          req,
          secret: process.env.AUTH_SECRET,
        });

  if (
    publicPath ||
    devBypass() ||
    sessionToken ||
    integrationsMachineBearer(req, pathname)
  ) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
