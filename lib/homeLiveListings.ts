import { dedupeLiveListings, isPlausibleLiveListing } from "./liveListings.ts";

export type HomeListingLead = {
  id: string;
  external_id: string | null;
  profile_id: string;
  review_status: string;
  source_listing_url: string;
  listing_title: string;
  listing_price: number | null;
  currency: string | null;
  item_end_at: string | null;
  last_seen_at: string;
};

export type HomeListingEdition = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  publisher: string | null;
  format: string | null;
  isbn_13: string | null;
  cover_image_url: string | null;
  cover_verification_status: string | null;
};

export type HomeListingProfile = { id: string; edition_id: string };

export type HomeListingCard = {
  id: string;
  editionId: string;
  editionTitle: string | null;
  series: string | null;
  volumeNumber: string | null;
  language: string | null;
  coverImageUrl: string;
  listingTitle: string;
  listingUrl: string;
  askingPrice: number;
  currency: string;
};

/** A small homepage sample of the same eligible leads shown by Buy Manga. */
export function selectHomeLiveListings(
  leads: HomeListingLead[],
  profiles: HomeListingProfile[],
  editions: HomeListingEdition[],
  now: Date,
  limit = 8,
): HomeListingCard[] {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const editionById = new Map(editions.map((edition) => [edition.id, edition]));
  const cutoff = now.getTime() - 48 * 60 * 60 * 1000;
  const candidates = dedupeLiveListings(leads.flatMap((lead) => {
    const profile = profileById.get(lead.profile_id);
    const edition = profile && editionById.get(profile.edition_id);
    const seenAt = Date.parse(lead.last_seen_at);
    if (!edition || edition.cover_verification_status !== "verified" || !edition.cover_image_url) return [];
    if (!Number.isFinite(seenAt) || seenAt < cutoff || seenAt > now.getTime()) return [];
    if (lead.item_end_at && Date.parse(lead.item_end_at) <= now.getTime()) return [];
    if (lead.review_status !== "watching" && (lead.review_status !== "new" || !isPlausibleLiveListing(lead, edition))) return [];
    if (lead.listing_price === null || !Number.isFinite(lead.listing_price) || lead.listing_price <= 0 || !lead.currency) return [];
    return [{ lead, edition, external_id: lead.external_id, source_listing_url: lead.source_listing_url }];
  }));

  const cards: HomeListingCard[] = [];
  const seenEditions = new Set<string>();
  const perSeries = new Map<string, number>();
  for (const { lead, edition } of candidates) {
    if (seenEditions.has(edition.id)) continue;
    const seriesKey = (edition.series || edition.title || edition.id).toLowerCase();
    if ((perSeries.get(seriesKey) ?? 0) >= 2) continue;
    seenEditions.add(edition.id);
    perSeries.set(seriesKey, (perSeries.get(seriesKey) ?? 0) + 1);
    cards.push({
      id: lead.id,
      editionId: edition.id,
      editionTitle: edition.title,
      series: edition.series,
      volumeNumber: edition.volume_number,
      language: edition.language,
      coverImageUrl: edition.cover_image_url!,
      listingTitle: lead.listing_title,
      listingUrl: lead.source_listing_url,
      askingPrice: lead.listing_price!,
      currency: lead.currency!,
    });
    if (cards.length >= limit) break;
  }
  return cards;
}
