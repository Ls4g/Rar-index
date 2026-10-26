import { normalizeIsbn, type CoverMatchTarget } from "./coverCandidateMatch.ts";
import { isbnAddressableCover, looksLikeImage } from "./vizCover.ts";

function decode(value: string) {
  return value.replace(/&#8211;|&ndash;/gi, "-").replace(/&bull;/gi, "•")
    .replace(/&amp;/gi, "&").replace(/&#39;/gi, "'").trim();
}

function stem(value: string) {
  return value.replace(/\b(?:vol(?:ume)?\.?)[\s-]*0*\d+\b/gi, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function volume(value: string) {
  const found = value.match(/\b(?:vol(?:ume)?\.?)\s*0*(\d{1,3})\b/i);
  return found ? Number(found[1]) : null;
}

function matchingSeries(source: string, target: string) {
  const sourceStem = stem(source);
  const targetStem = stem(target);
  return sourceStem === targetStem || (sourceStem === "baki" && targetStem === "baki the grappler");
}

function meta(html: string, property: string) {
  const tag = html.match(new RegExp(`<meta\\b(?=[^>]*property=["']${property}["'])[^>]*>`, "i"))?.[0];
  return tag?.match(/content=["']([^"']+)["']/i)?.[1] ?? null;
}

type SearchHit = { title?: string; url?: string; subtype?: string };

export async function findKodamaCover(target: CoverMatchTarget, fetchImpl: typeof fetch = fetch) {
  const empty = (emptyReason: string) => ({ candidates: [], emptyReason });
  if (!/\bkodama(?:\s+tales)?\b/i.test(target.publisher ?? "") || !/^(?:en|eng|english)$/i.test(target.language?.trim() ?? "")) {
    return empty("Kodama title search is for its English editions only.");
  }
  const addressable = isbnAddressableCover(target);
  if (!addressable.usable) return empty(addressable.reason ?? "This edition needs a distinct cover source.");
  const targetVolume = Number(target.volumeNumber);
  const series = target.series?.trim();
  if (!series || !Number.isInteger(targetVolume) || targetVolume < 1 || targetVolume > 999) {
    return empty("Series and volume are required for Kodama title search.");
  }

  const searchUrl = `https://kodama-tales.com/wp-json/wp/v2/search?search=${encodeURIComponent(`${series} ${targetVolume}`)}&per_page=100`;
  const search = await fetchImpl(searchUrl, {
    cache: "no-store", signal: AbortSignal.timeout(15_000),
    headers: { Accept: "application/json", "User-Agent": "RAR-Index-Cover-Research/1.0 (catalogue cover review)" },
  });
  if (!search.ok) throw new Error(`Kodama title search returned ${search.status}`);
  const hits = await search.json() as SearchHit[];
  if (!Array.isArray(hits)) throw new Error("Kodama title search changed its result format.");
  const matches = hits.filter((hit) => hit.subtype === "project" && hit.title
    && volume(decode(hit.title)) === targetVolume && matchingSeries(decode(hit.title), series)
    && /^https:\/\/kodama-tales\.com\/project\/[a-z0-9-]+\/$/.test(hit.url ?? ""));
  if (matches.length !== 1) return empty(matches.length ? "Kodama returned multiple matching volume pages; staff must choose one." : "No matching Kodama volume page was found.");

  const page = await fetchImpl(matches[0].url!, {
    cache: "no-store", signal: AbortSignal.timeout(15_000), redirect: "error",
    headers: { Accept: "text/html", "User-Agent": "RAR-Index-Cover-Research/1.0 (catalogue cover review)" },
  });
  if (!page.ok || page.url !== matches[0].url) return empty("The matching Kodama volume page could not be read safely.");
  const html = await page.text();
  const title = decode(meta(html, "og:title")?.split("&bull;")[0] ?? "");
  const imageValue = meta(html, "og:image");
  if (volume(title) !== targetVolume || !matchingSeries(title, series) || !imageValue) {
    return empty("The Kodama page title, volume, or cover did not match its search result.");
  }
  let imageUrl: URL;
  try { imageUrl = new URL(imageValue); }
  catch { return empty("The Kodama page's cover URL is invalid."); }
  if (imageUrl.protocol !== "https:" || imageUrl.hostname !== "kodama-tales.com"
    || !imageUrl.pathname.startsWith("/wp-content/uploads/")) {
    return empty("The Kodama page has no approved publisher-hosted cover URL.");
  }
  const image = await fetchImpl(imageUrl.toString(), {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
    headers: { Accept: "image/*", "User-Agent": "RAR-Index-Cover-Research/1.0 (catalogue cover review)" },
  });
  if (!image.ok) return empty(`The Kodama cover returned HTTP ${image.status}.`);
  const bytes = new Uint8Array(await image.arrayBuffer());
  if (bytes.byteLength < 5_000 || !looksLikeImage(bytes)) return empty("The Kodama cover URL is not a usable image.");

  // Kodama's page names a title and volume but does not state the ISBN.
  // Preserve that absence, and offer a partial lead for human verification.
  return { candidates: [{
    sourceName: "Kodama Tales" as const,
    externalId: matches[0].url!,
    coverImageUrl: imageUrl.toString(),
    sourceRecordUrl: matches[0].url!,
    candidateTitle: title,
    candidatePublisher: "Kodama Tales",
    candidateLanguage: null,
    candidateIsbn13: null,
    matchScore: 35,
    matchConfidence: "partial" as const,
    matchReasons: ["Official publisher title and volume agree", "Kodama does not state an ISBN on this page; verify the exact physical edition before approval"],
    rawPayload: { importer: "kodama_title_search", query: `${series} ${targetVolume}`, target_isbn_13: normalizeIsbn(target.isbn13), source_isbn_13: null },
  }] };
}
