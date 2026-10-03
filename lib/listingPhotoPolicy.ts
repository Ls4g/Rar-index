// eBay listing imagery is a short-lived pointer to a current listing, not
// permanent catalogue art. Use a safety margin below the six-hour display
// limit so an old scan never silently becomes an issue cover.
const MAX_LISTING_PHOTO_AGE_MS = 5 * 60 * 60 * 1000;

export function isFreshListingPhoto(capturedAt: string | null | undefined, now = new Date()) {
  if (!capturedAt) return false;
  const age = now.getTime() - Date.parse(capturedAt);
  return Number.isFinite(age) && age >= 0 && age < MAX_LISTING_PHOTO_AGE_MS;
}
