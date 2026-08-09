// Client-side mirror of the rules enforced in
// supabase/migrations/20260811_collector_usernames.sql (the format check
// constraint + the reserved-word trigger). This only gives instant
// feedback without a round trip -- the database remains the real source of
// truth, and every save is re-validated there regardless of what this
// module says.
const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_]{2,19}$/;

export const USERNAME_FORMAT_HINT = "3-20 characters: letters, numbers, and underscores only, starting with a letter or number.";

const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "staff", "support", "help", "about", "contact",
  "null", "undefined", "root", "rar", "index", "www", "home", "login", "logout",
  "signin", "signup", "sign-in", "sign-up", "settings", "setting", "profile", "profiles",
  "user", "users", "moderator", "mod", "system", "security", "terms", "privacy",
  "legal", "api", "me", "you", "collector", "collectors",
  "add-sale", "browse", "catalogue-import", "catalogue-requests",
  "catalogue-review", "collection-profiles", "community-reports", "cover-review",
  "coverage-dashboard", "data-readiness", "edition", "identify", "portfolio",
  "price-import", "request-edition", "review", "scout", "staff-login",
]);

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function validateUsernameFormat(value: string): string | null {
  if (!USERNAME_PATTERN.test(value)) return USERNAME_FORMAT_HINT;
  if (RESERVED_USERNAMES.has(normalizeUsername(value))) return "That handle is reserved and can't be used.";
  return null;
}
