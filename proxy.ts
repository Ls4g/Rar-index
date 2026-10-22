import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { hasValidBasicAuthorization, hasValidStaffSession, staffBasicAuthorization } from "@/lib/staffSession";
import { claimLoginAttempt, loginFingerprint, tooManyAttemptsResponse } from "@/lib/staffLoginRateLimit";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export default async function proxy(request: NextRequest) {
  if (hasValidBasicAuthorization(request)) return NextResponse.next();

  // A wrong Basic header is a sign-in attempt, and it used to be an uncounted
  // one: three wrong credentials against /review returned the same redirect
  // three times, with nothing recorded. Limiting only the sign-in form would
  // have left this door open, so it is counted on the same budget.
  //
  // Only a PRESENT-but-wrong header counts. An ordinary unauthenticated visit
  // -- a person, a crawler -- carries no Authorization header and must not
  // cost a database write, or refusing anonymous traffic would become a way to
  // hammer the database.
  if (request.headers.get("authorization")?.startsWith("Basic ")) {
    const fingerprint = await loginFingerprint(request);
    const gate = await claimLoginAttempt(getSupabaseAdmin(), fingerprint);
    // Failing closed costs nothing here: these credentials are already wrong,
    // so the request was going to be refused either way.
    if (!gate || !gate.allowed) return tooManyAttemptsResponse(gate?.retryAfterSeconds ?? 60);
  }

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
    "/graded-revisit/:path*",
    "/listing-outcomes/:path*",
    "/price-coverage/:path*",
    "/cover-review/:path*",
    "/agents/:path*",
    "/agent-learning/:path*",
    "/homepage-spotlight/:path*",
    "/api/review/:path*",
    "/api/listing-outcomes/:path*",
    "/api/price-coverage/:path*",
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
    "/api/graded-revisit/:path*",
    "/api/scout-labels/:path*",
    "/api/cover-review/:path*",
    "/api/agents/:path*",
    "/api/agent-reliability/:path*",
    "/api/homepage-spotlight/:path*",
  ],
};
