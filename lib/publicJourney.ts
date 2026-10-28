export const PUBLIC_JOURNEY_EVENTS = ["catalogue_search", "edition_view", "shelf_add", "listing_click"] as const;
export type PublicJourneyEvent = (typeof PUBLIC_JOURNEY_EVENTS)[number];

export function isPublicJourneyEvent(value: unknown): value is PublicJourneyEvent {
  return typeof value === "string" && PUBLIC_JOURNEY_EVENTS.includes(value as PublicJourneyEvent);
}

export function sameOriginEvent(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
