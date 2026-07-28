import { NextResponse } from "next/server";
import { createStaffSession, isValidStaffCredential, STAFF_SESSION_COOKIE, STAFF_SESSION_MAX_AGE_SECONDS } from "@/lib/staffSession";

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
  if (!isValidStaffCredential(username, password)) {
    return NextResponse.json({ error: "Those staff credentials are not recognised." }, { status: 401 });
  }
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
