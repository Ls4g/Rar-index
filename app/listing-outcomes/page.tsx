import { permanentRedirect } from "next/navigation";

// Replaced by /price-coverage.
//
// This page listed 2,945 individual watched listings behind eight queue tabs
// and three view tabs. 636 sat in "worth checking" and, across two and a half
// months, three had ever been opened by a person: a list nobody can finish is
// not a worklist, and the number the work was actually for -- a current price
// on each edition -- appeared nowhere on it. /price-coverage lists the 235
// editions instead, and opens one edition's listings at a time with the same
// decision controls and none of the filters.
//
// Kept as a redirect rather than deleted because other pages deep-link here,
// including Decisions sending a single listing to have its price recorded. A
// 308 moves those links, and anything bookmarked, to the edition that listing
// belongs to instead of breaking.
export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ListingOutcomesRedirect({ searchParams }: {
  searchParams: Promise<{ outcome?: string | string[] }>;
}) {
  const parameters = await searchParams;
  const outcome = one(parameters.outcome);
  // Only `outcome` carries over. The old view, queue, sort, page and search
  // parameters describe filters that no longer exist, and forwarding them
  // would imply /price-coverage honours them.
  permanentRedirect(outcome ? `/price-coverage?outcome=${encodeURIComponent(outcome)}` : "/price-coverage");
}
