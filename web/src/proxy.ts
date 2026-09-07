import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

export async function proxy(request: NextRequest) {
  const appBaseUrl = process.env.APP_BASE_URL;
  if (appBaseUrl) {
    const canonicalUrl = new URL(appBaseUrl);
    if (request.nextUrl.origin !== canonicalUrl.origin) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.protocol = canonicalUrl.protocol;
      redirectUrl.host = canonicalUrl.host;
      return NextResponse.redirect(redirectUrl);
    }
  }

  return auth0.middleware(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
