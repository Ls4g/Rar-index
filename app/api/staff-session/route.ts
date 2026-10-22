import { NextResponse } from "next/server";
import { createStaffSession, isValidStaffCredential, STAFF_SESSION_COOKIE, STAFF_SESSION_MAX_AGE_SECONDS } from "@/lib/staffSession";
import { claimLoginAttempt, clearLoginAttempts, loginFingerprint, tooManyAttemptsResponse } from "@/lib/staffLoginRateLimit";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const sessionCookie = { httpOnly: true, maxAge: STAFF_SESSION_MAX_AGE_SECONDS, path: "/", sameSite: "lax" as const, secure: true };

export async function POST(request: Request) {
  let payload: { username?: unknown; password?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter your staff username and password." }, { status: 400 });
  }
  const username = typeof payload.username === "string" ? payload.username : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  // Claimed before the comparison, so guesses are stopped without the password
  // ever being checked. A refusal here is deliberate: an attempt that cannot be
  // counted is the one worth refusing, and if the database is unreachable the
  // staff pages have nothing to serve anyway.
  const admin = getSupabaseAdmin();
  const fingerprint = await loginFingerprint(request);
  const gate = await claimLoginAttempt(admin, fingerprint);
  if (!gate) {
    return NextResponse.json({ error: "Sign-in protection is unavailable, so sign-in is closed. Try again shortly." }, { status: 503 });
  }
  if (!gate.allowed) return tooManyAttemptsResponse(gate.retryAfterSeconds);

  if (!isValidStaffCredential(username, password)) {
    return NextResponse.json({ error: "Those staff credentials are not recognised." }, { status: 401 });
  }
  // Only repeated failures should accumulate, so getting it right starts over.
  await clearLoginAttempts(admin, fingerprint);
  const session = await createStaffSession();
  if (!session) return NextResponse.json({ error: "Staff sign-in is not configured yet." }, { status: 503 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(STAFF_SESSION_COOKIE, session, sessionCookie);
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(STAFF_SESSION_COOKIE, "", { ...sessionCookie, maxAge: 0 });
  return response;
}
