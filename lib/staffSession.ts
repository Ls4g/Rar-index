export const STAFF_SESSION_COOKIE = "rar_staff_session";
export const STAFF_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

type SessionPayload = { version: 1; expiresAt: number };

function staffCredentials() {
  const username = process.env.RAR_REVIEW_USERNAME;
  const password = process.env.RAR_REVIEW_PASSWORD;
  return username && password ? { username, password } : null;
}

export function staffBasicAuthorization() {
  const configured = staffCredentials();
  return configured ? `Basic ${btoa(`${configured.username}:${configured.password}`)}` : null;
}

function constantTimeEqual(left: string, right: string) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signature(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(signed));
}

function cookieValue(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const entry = cookieHeader.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${STAFF_SESSION_COOKIE}=`));
  return entry ? entry.slice(STAFF_SESSION_COOKIE.length + 1) : null;
}

export function isValidStaffCredential(username: string, password: string) {
  const configured = staffCredentials();
  return Boolean(configured && constantTimeEqual(username, configured.username) && constantTimeEqual(password, configured.password));
}

export function hasValidBasicAuthorization(request: Request) {
  const configured = staffCredentials();
  const authorization = request.headers.get("authorization");
  if (!configured || !authorization?.startsWith("Basic ")) return false;
  try {
    const provided = atob(authorization.slice(6));
    const separator = provided.indexOf(":");
    return separator !== -1
      && constantTimeEqual(provided.slice(0, separator), configured.username)
      && constantTimeEqual(provided.slice(separator + 1), configured.password);
  } catch {
    return false;
  }
}

export async function createStaffSession() {
  const configured = staffCredentials();
  if (!configured) return null;
  const payload: SessionPayload = { version: 1, expiresAt: Date.now() + STAFF_SESSION_MAX_AGE_SECONDS * 1000 };
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encodedPayload}.${await signature(encodedPayload, configured.password)}`;
}

export async function hasValidStaffSession(request: Request) {
  const configured = staffCredentials();
  const token = cookieValue(request);
  if (!configured || !token) return false;
  try {
    const [encodedPayload, providedSignature, extra] = token.split(".");
    if (!encodedPayload || !providedSignature || extra) return false;
    if (!constantTimeEqual(providedSignature, await signature(encodedPayload, configured.password))) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as SessionPayload;
    return payload.version === 1 && typeof payload.expiresAt === "number" && payload.expiresAt > Date.now();
  } catch {
    return false;
  }
}

export async function isStaffRequest(request: Request) {
  return hasValidBasicAuthorization(request) || hasValidStaffSession(request);
}
