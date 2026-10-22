import type { SupabaseClient } from "@supabase/supabase-js";

// Counting sign-in attempts, so the staff credential cannot be guessed at
// machine speed.
//
// There are two doors into staff access and both are covered, because securing
// one and not the other secures nothing:
//
//   POST /api/staff-session          the sign-in form
//   Authorization: Basic <...>       accepted directly by proxy.ts
//
// Measured before this existed: three wrong Basic credentials in a row against
// /review all returned the same redirect, with nothing counted and nothing
// slowed down.
//
// The attempt is claimed BEFORE the password is compared, so a flood is
// stopped without the comparison ever running.

export const STAFF_LOGIN_MAX_ATTEMPTS = 10;
export const STAFF_LOGIN_WINDOW_MINUTES = 15;

export type LoginGate = { allowed: boolean; remaining: number; retryAfterSeconds: number };

/**
 * The migration has not been applied yet.
 *
 * Deploy order would otherwise lock the owner out of their own site: code that
 * refuses every sign-in it cannot count, shipped before the function it calls
 * exists, means nobody can get in and the only way back is the database. So a
 * missing function is read as "not deployed yet" and allowed through, while
 * every other failure is still refused. The same distinction the reliability
 * cron already makes for recover_expired_agent_action_leases.
 */
function isMissingFunction(message: string) {
  return /does not exist|schema cache|could not find the function/i.test(message);
}

/**
 * A stable, non-reversible id for the caller.
 *
 * Hashed rather than stored raw: this is here to count attempts, not to keep a
 * record of who visited. Falls back to a constant when no address header is
 * present, which groups those callers together rather than letting a missing
 * header mean "unlimited".
 */
export async function loginFingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`staff-login:${address}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Count one attempt and report whether it may proceed.
 *
 * Returns null when the limiter itself could not be reached. The caller decides
 * what that means; both callers here refuse, because an attempt that cannot be
 * counted is exactly the one worth refusing, and the database being unreachable
 * means the staff pages have nothing to show anyway.
 */
export async function claimLoginAttempt(admin: SupabaseClient, fingerprint: string): Promise<LoginGate | null> {
  const { data, error } = await admin.rpc("claim_staff_login_attempt", { p_fingerprint: fingerprint });
  if (error && isMissingFunction(error.message ?? "")) {
    console.error(JSON.stringify({ event: "staff_login_limiter_not_deployed" }));
    return { allowed: true, remaining: STAFF_LOGIN_MAX_ATTEMPTS, retryAfterSeconds: 0 };
  }
  if (error || !data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (typeof record.allowed !== "boolean") return null;
  return {
    allowed: record.allowed,
    remaining: typeof record.remaining === "number" ? record.remaining : 0,
    retryAfterSeconds: typeof record.retry_after_seconds === "number" ? record.retry_after_seconds : 0,
  };
}

/** A correct sign-in wipes the count, so only repeated failures accumulate. */
export async function clearLoginAttempts(admin: SupabaseClient, fingerprint: string) {
  const { error } = await admin.rpc("clear_staff_login_attempts", { p_fingerprint: fingerprint });
  // Never fatal: the person signed in correctly, and their window will lapse on
  // its own within STAFF_LOGIN_WINDOW_MINUTES regardless.
  if (error) console.error(JSON.stringify({ event: "staff_login_counter_not_cleared" }));
}

export function tooManyAttemptsResponse(retryAfterSeconds: number) {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return Response.json(
    { error: `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
    { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) } },
  );
}
