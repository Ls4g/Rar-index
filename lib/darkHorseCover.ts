import { normalizeIsbn, type CoverMatchTarget } from "./coverCandidateMatch.ts";
import { isbnAddressableCover, looksLikeImage } from "./vizCover.ts";

// Dark Horse's own catalogue: search by ISBN, open the single product page
// it returns, and take the cover only if that page prints the same ISBN-13.
// Because the publisher's page states the ISBN, a match here is exact, unlike
// title-only publisher sources (Kodama), which stay partial leads.
const SITE = "https://www.darkhorse.com";
const PRODUCT_PATH = /^\/books\/(\d+-\d+)\/[a-z0-9-]+\/?$/i;
const HEADERS = { "User-Agent": "RAR-Index-Cover-Research/1.0 (catalogue cover review)" };

function meta(html: string, property: string) {
  const tag = html.match(new RegExp(`<meta\\b(?=[^>]*property=["']${property}["'])[^>]*>`, "i"))?.[0];
  return tag?.match(/content=["']([^"']+)["']/i)?.[1] ?? null;
}

/** Product page links in a Dark Horse search page, one per product. */
export function darkHorseProductLinks(html: string) {
  const ids = new Map<string, string>();
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    let url: URL;
    try { url = new URL(match[1], SITE); } catch { continue; }
    if (url.hostname !== "www.darkhorse.com") continue;
    const path = url.pathname.match(PRODUCT_PATH);
    if (path && !ids.has(path[1])) ids.set(path[1], `${SITE}${url.pathname.toLowerCase().replace(/\/?$/, "/")}`);
  }
  return [...ids.values()];
}

export async function findDarkHorseCover(target: CoverMatchTarget, fetchImpl: typeof fetch = fetch) {
  const empty = (emptyReason: string) => ({ candidates: [], emptyReason });
  if (!/\bdark\s*horse\b/i.test(target.publisher ?? "")) return empty("Dark Horse search is for Dark Horse editions only.");
  const isbn = normalizeIsbn(target.isbn13);
  if (!isbn || isbn.length !== 13) return empty("An ISBN-13 is required for Dark Horse search.");
  const addressable = isbnAddressableCover(target);
  if (!addressable.usable) return empty(addressable.reason ?? "This edition needs a distinct cover source.");

  const searchUrl = `${SITE}/Search/${isbn}`;
  const search = await fetchImpl(searchUrl, { cache: "no-store", signal: AbortSignal.timeout(15_000), headers: { ...HEADERS, Accept: "text/html" } });
  if (!search.ok) throw new Error(`Dark Horse search returned ${search.status}`);
  const links = darkHorseProductLinks(await search.text());
  if (links.length !== 1) return empty(links.length ? "Dark Horse returned several products for this ISBN; staff must choose." : "Dark Horse has no product for this ISBN.");

  const page = await fetchImpl(links[0], { cache: "no-store", signal: AbortSignal.timeout(15_000), headers: { ...HEADERS, Accept: "text/html" } });
  if (!page.ok) return empty(`The Dark Horse product page returned HTTP ${page.status}.`);
  const html = await page.text();
  const printed = new Set([...html.matchAll(/\b97[89]\d{10}\b/g)].map((m) => m[0]));
  if (!printed.has(isbn)) return empty("The Dark Horse product page does not print this edition's ISBN-13.");
  const imageValue = meta(html, "og:image");
  let imageUrl: URL;
  try { imageUrl = new URL(imageValue ?? ""); } catch { return empty("The Dark Horse page has no cover image."); }
  if (imageUrl.protocol !== "https:" || imageUrl.hostname !== "images.darkhorse.com" || !imageUrl.pathname.startsWith("/covers/")) {
    return empty("The Dark Horse page's cover is not hosted on Dark Horse's cover server.");
  }
  const image = await fetchImpl(imageUrl.toString(), { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000), headers: { ...HEADERS, Accept: "image/*" } });
  if (!image.ok) return empty(`The Dark Horse cover returned HTTP ${image.status}.`);
  const bytes = new Uint8Array(await image.arrayBuffer());
  if (bytes.byteLength < 5_000 || !looksLikeImage(bytes)) return empty("The Dark Horse cover URL is not a usable image.");

  const title = (meta(html, "og:title") ?? "").split("::")[0].trim() || null;
  return { candidates: [{
    sourceName: "Dark Horse" as const,
    externalId: links[0],
    coverImageUrl: imageUrl.toString(),
    sourceRecordUrl: links[0],
    candidateTitle: title,
    candidatePublisher: "Dark Horse Comics",
    candidateLanguage: "English",
    candidateIsbn13: isbn,
    matchScore: 90,
    matchConfidence: "strong" as const,
    matchReasons: ["Official Dark Horse product page", "The page prints this edition's exact ISBN-13"],
    rawPayload: { importer: "dark_horse_isbn_search", search_url: searchUrl, target_isbn_13: isbn, source_isbn_13: isbn },
  }] };
}
