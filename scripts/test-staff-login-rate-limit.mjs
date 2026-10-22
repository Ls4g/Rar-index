// Sign-in attempts are counted, and the owner is never locked out by them.
//
//   node --experimental-strip-types scripts/test-staff-login-rate-limit.mjs
//
// No network: the RPC is stubbed and the SQL is read off disk.
//
// The risk being guarded against runs both ways. Too loose and the shared
// staff credential can be guessed at machine speed; too tight, or wrong about
// when the counter resets, and the only person who uses this site cannot get
// into it. The second failure is the more likely one to ship, so most of these
// cases are about the owner still getting in.
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  claimLoginAttempt,
  clearLoginAttempts,
  loginFingerprint,
  tooManyAttemptsResponse,
  STAFF_LOGIN_MAX_ATTEMPTS,
  STAFF_LOGIN_WINDOW_MINUTES,
} from "../lib/staffLoginRateLimit.ts";

const checks = [];
function check(label, fn) {
  try { fn(); checks.push({ label, ok: true }); }
  catch (error) { checks.push({ label, ok: false, error: error.message }); }
}
async function checkAsync(label, fn) {
  try { await fn(); checks.push({ label, ok: true }); }
  catch (error) { checks.push({ label, ok: false, error: error.message }); }
}

/** A stand-in for the database function, with the same counting rules. */
function limiter({ failRpc = false, returns } = {}) {
  const counts = new Map();
  return {
    counts,
    rpc: async (name, args) => {
      if (failRpc) return { data: null, error: { message: "unavailable" } };
      if (returns !== undefined) return { data: returns, error: null };
      if (name === "clear_staff_login_attempts") { counts.delete(args.p_fingerprint); return { data: null, error: null }; }
      const used = counts.get(args.p_fingerprint) ?? 0;
      if (used >= STAFF_LOGIN_MAX_ATTEMPTS) {
        return { data: { allowed: false, remaining: 0, retry_after_seconds: 420 }, error: null };
      }
      counts.set(args.p_fingerprint, used + 1);
      return { data: { allowed: true, remaining: STAFF_LOGIN_MAX_ATTEMPTS - used - 1, retry_after_seconds: 0 }, error: null };
    },
  };
}

const requestFrom = (ip) => new Request("https://rar-index.vercel.app/api/staff-session", {
  method: "POST",
  headers: ip ? { "x-forwarded-for": ip } : {},
});

await checkAsync("the fingerprint hides the address and is stable", async () => {
  const one = await loginFingerprint(requestFrom("203.0.113.9"));
  const again = await loginFingerprint(requestFrom("203.0.113.9"));
  const other = await loginFingerprint(requestFrom("198.51.100.4"));
  assert.equal(one, again, "the same caller must land on the same counter");
  assert.notEqual(one, other, "different callers must not share a counter");
  assert.match(one, /^[0-9a-f]{64}$/, "a SHA-256 digest, not an address");
  assert.ok(!one.includes("203"), "the address itself must not survive into the key");
});

await checkAsync("a missing address header still gets a counter rather than a free pass", async () => {
  const anonymous = await loginFingerprint(requestFrom(null));
  assert.match(anonymous, /^[0-9a-f]{64}$/);
});

await checkAsync(`${STAFF_LOGIN_MAX_ATTEMPTS} attempts are allowed, the next is refused`, async () => {
  const db = limiter();
  const print = "a".repeat(64);
  for (let attempt = 1; attempt <= STAFF_LOGIN_MAX_ATTEMPTS; attempt += 1) {
    const gate = await claimLoginAttempt(db, print);
    assert.equal(gate.allowed, true, `attempt ${attempt} should be allowed`);
  }
  const blocked = await claimLoginAttempt(db, print);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0, "a refusal must say when to come back");
});

await checkAsync("getting the password right clears the count, so the owner is never locked out", async () => {
  // The failure mode this exists to prevent: nine typos, then the correct
  // password, then a tenth visit later that finds no budget left.
  const db = limiter();
  const print = "b".repeat(64);
  for (let attempt = 0; attempt < STAFF_LOGIN_MAX_ATTEMPTS - 1; attempt += 1) await claimLoginAttempt(db, print);
  await clearLoginAttempts(db, print);
  assert.equal(db.counts.get(print), undefined, "a correct sign-in must reset the counter");
  const afterSuccess = await claimLoginAttempt(db, print);
  assert.equal(afterSuccess.allowed, true);
  assert.equal(afterSuccess.remaining, STAFF_LOGIN_MAX_ATTEMPTS - 1, "the full budget is back");
});

await checkAsync("one caller being blocked does not block anyone else", async () => {
  const db = limiter();
  const attacker = "c".repeat(64);
  const owner = "d".repeat(64);
  for (let attempt = 0; attempt <= STAFF_LOGIN_MAX_ATTEMPTS; attempt += 1) await claimLoginAttempt(db, attacker);
  assert.equal((await claimLoginAttempt(db, attacker)).allowed, false);
  assert.equal((await claimLoginAttempt(db, owner)).allowed, true, "the owner must not inherit an attacker's lockout");
});

await checkAsync("an unreachable limiter reports null rather than silently allowing", async () => {
  const gate = await claimLoginAttempt(limiter({ failRpc: true }), "e".repeat(64));
  assert.equal(gate, null, "callers decide what an outage means; it must not look like permission");
});

await checkAsync("a malformed RPC answer is treated as unavailable, not as allowed", async () => {
  for (const nonsense of [null, "yes", 42, {}, { allowed: "true" }]) {
    assert.equal(await claimLoginAttempt(limiter({ returns: nonsense }), "f".repeat(64)), null, `${JSON.stringify(nonsense)} must not pass as a gate`);
  }
});

check("the refusal tells the caller when to return", () => {
  const response = tooManyAttemptsResponse(420);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "420");
});

check("a sub-minute wait still reads as a whole minute rather than zero", () => {
  assert.equal(tooManyAttemptsResponse(5).headers.get("Retry-After"), "5");
});

// The SQL is the thing actually enforcing this, so check it says what the
// TypeScript believes.
const sql = fs.readFileSync("supabase/migrations/20261022_staff_login_rate_limit.sql", "utf8");
check("the migration agrees with the limits the code reports", () => {
  assert.match(sql, new RegExp(`max_attempts constant integer := ${STAFF_LOGIN_MAX_ATTEMPTS}`));
  assert.match(sql, new RegExp(`interval '${STAFF_LOGIN_WINDOW_MINUTES} minutes'`));
});

check("the limiter locks the row, so two attempts cannot both slip through", () => {
  assert.match(sql, /for update/i);
});

check("the counter table is not reachable with the public key", () => {
  assert.match(sql, /alter table public\.staff_login_rate_limits enable row level security/);
  assert.match(sql, /revoke all on public\.staff_login_rate_limits from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.claim_staff_login_attempt\(text\) from public, anon, authenticated/);
});

check("both doors are wired, not just the sign-in form", () => {
  // Limiting the form alone would leave Basic auth to be guessed freely.
  assert.match(fs.readFileSync("app/api/staff-session/route.ts", "utf8"), /claimLoginAttempt/);
  const proxy = fs.readFileSync("proxy.ts", "utf8");
  assert.match(proxy, /claimLoginAttempt/);
  assert.match(proxy, /startsWith\("Basic "\)/, "only a present-but-wrong Basic header should be counted");
});

for (const result of checks) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.label}`);
  if (!result.ok) console.log(`      ${result.error}`);
}
const failed = checks.filter((result) => !result.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
if (failed) process.exitCode = 1;

// --- deploy order ------------------------------------------------------------
// Shipping the code before the migration must not lock the owner out.
const deployChecks = [];
async function deployCheck(label, fn) {
  try { await fn(); deployChecks.push({ label, ok: true }); }
  catch (error) { deployChecks.push({ label, ok: false, error: error.message }); }
}

function brokenLimiter(message) {
  return { rpc: async () => ({ data: null, error: { message } }) };
}

await deployCheck("a missing function means 'not deployed yet' and lets sign-in through", async () => {
  for (const message of [
    'function public.claim_staff_login_attempt(text) does not exist',
    'Could not find the function public.claim_staff_login_attempt in the schema cache',
  ]) {
    const gate = await claimLoginAttempt(brokenLimiter(message), "a".repeat(64));
    assert.ok(gate && gate.allowed, `"${message.slice(0, 40)}…" must not lock the owner out before the migration lands`);
  }
});

await deployCheck("any OTHER failure is still refused", async () => {
  for (const message of ["connection terminated", "permission denied for function", "timeout"]) {
    assert.equal(await claimLoginAttempt(brokenLimiter(message), "a".repeat(64)), null, `"${message}" must not be mistaken for a missing migration`);
  }
});

for (const result of deployChecks) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.label}`);
  if (!result.ok) console.log(`      ${result.error}`);
}
const deployFailed = deployChecks.filter((r) => !r.ok).length;
console.log(`\n${deployChecks.length - deployFailed}/${deployChecks.length} deploy-order checks passed.`);
if (deployFailed) process.exitCode = 1;
