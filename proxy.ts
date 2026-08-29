import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { hasValidBasicAuthorization, hasValidStaffSession, staffBasicAuthorization } from "@/lib/staffSession";

export default async function proxy(request: NextRequest) {
  if (hasValidBasicAuthorization(request)) return NextResponse.next();

  if (await hasValidStaffSession(request)) {
    const authorization = staffBasicAuthorization();
    if (!authorization) return NextResponse.json({ error: "Staff sign-in is not configured." }, { status: 503 });
    const headers = new Headers(request.headers);
    headers.set("authorization", authorization);
    return NextResponse.next({ request: { headers } });
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Staff sign-in is required." }, { status: 401 });
  }

  const signInUrl = new URL("/staff-login", request.url);
  signInUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: [
    "/review/:path*",
    "/catalogue-import/:path*",
    "/catalogue-review/:path*",
    "/discovery-backlog/:path*",
    "/price-import/:path*",
    "/add-sale/:path*",
    "/collection-profiles/:path*",
    "/data-readiness/:path*",
    "/coverage-dashboard/:path*",
    "/community-reports/:path*",
    "/catalogue-requests/:path*",
    "/scout/:path*",
    "/listing-outcomes/:path*",
    "/cover-review/:path*",
    "/agents/:path*",
    "/agent-learning/:path*",
    "/api/review/:path*",
    "/api/listing-outcomes/:path*",
    "/api/print-classification/:path*",
    "/api/catalogue-import/:path*",
    "/api/catalogue-review/:path*",
    "/api/price-import/:path*",
    "/api/add-sale/:path*",
    "/api/collection-runs/:path*",
    "/api/collection-profiles/:path*",
    "/api/community-reports/:path*",
    "/api/catalogue-requests/:path*",
    "/api/scout/:path*",
    "/api/scout-leads/:path*",
    "/api/scout-labels/:path*",
    "/api/cover-review/:path*",
    "/api/agents/:path*",
  ],
};
