import { normalizeIsbn, type CoverMatchTarget } from "./coverCandidateMatch.ts";
import { isbnAddressableCover, looksLikeImage } from "./vizCover.ts";

// Simon & Schuster distributes VIZ Media (and others) and keeps a product page
// for each ISBN. /books/<ISBN> redirects to it; the page's structured data
// names the book's ISBN, and its cover sits on S&S's image CDN in several
// sizes, the largest ("_hr", about 1500px wide) far sharper than most library
// covers. The cover is offered only when the page's own Book record carries
// the same ISBN-13, so a match is exact.
const SITE = "https://www.simonandschuster.com";
const IMAGE_HOST = "d28hgpri8am2if.cloudfront.net";
const HEADERS = { "User-Agent": "RAR-Index-Cover-Research/1.0 (catalogue cover review)" };

function meta(html: string, property: string) {
  const tag = html.match(new RegExp(`<meta\\b(?=[^>]*property=["']${property}["'])[^>]*>`, "i"))?.[0];
  return tag?.match(/content=["']([^"']+)["']/i)?.[1] ?? null;
}

/** The schema.org Book records on a page, as { isbn, name }. */
export function simonSchusterBooks(html: string) {
  const books: Array<{ isbn: string | null; name: string | null }> = [];
  for (const block of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    try { parsed = JSON.parse(block[1]); } catch { continue; }
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      if (item && typeof item === "object" && (item as { "@type"?: unknown })["@type"] === "Book") {
        const record = item as { isbn?: unknown; name?: unknown };
        books.push({ isbn: typeof record.isbn === "string" ? normalizeIsbn(record.isbn) : null, name: typeof record.name === "string" ? record.name : null });
      }
    }
  }
  return books;
}

/** The S&S cover URL for this ISBN, at the given size suffix ("_hr", "_lg" or ""). */
export function simonSchusterSizedCover(imageUrl: string, isbn: string, suffix: "_hr" | "_lg" | "") {
  let url: URL;
  try { url = new URL(imageUrl); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== IMAGE_HOST || !url.pathname.startsWith(`/book_images/onix/cvr${isbn}/`)) return null;
  url.pathname = url.pathname.replace(/(?:_hr|_lg)?\.jpg$/i, `${suffix}.jpg`);
  return url.pathname.endsWith(".jpg") ? url.toString() : null;
}

export async function findSimonSchusterCover(target: CoverMatchTarget, fetchImpl: typeof fetch = fetch) {
  const empty = (emptyReason: string) => ({ candidates: [], emptyReason });
  if (!/^(?:en|eng|english)$/i.test(target.language?.trim() ?? "")) return empty("Simon & Schuster search is for English editions only.");
  const isbn = normalizeIsbn(target.isbn13);
  if (!isbn || isbn.length !== 13) return empty("An ISBN-13 is required for Simon & Schuster search.");
  const addressable = isbnAddressableCover(target);
  if (!addressable.usable) return empty(addressable.reason ?? "This edition needs a distinct cover source.");

  const lookupUrl = `${SITE}/books/${isbn}`;
  const page = await fetchImpl(lookupUrl, { cache: "no-store", signal: AbortSignal.timeout(15_000), headers: { ...HEADERS, Accept: "text/html" } });
  if (page.status === 404) return empty("Simon & Schuster has no page for this ISBN.");
  if (!page.ok) throw new Error(`Simon & Schuster returned ${page.status}`);
  let finalUrl: URL;
  try { finalUrl = new URL(page.url || lookupUrl); } catch { return empty("Simon & Schuster redirected somewhere unexpected."); }
  if (finalUrl.hostname !== "www.simonandschuster.com" || !finalUrl.pathname.startsWith("/books/") || !finalUrl.pathname.replace(/\/$/, "").endsWith(isbn)) {
    return empty("Simon & Schuster did not resolve this ISBN to its own product page.");
  }
  const html = await page.text();
  const book = simonSchusterBooks(html).find((record) => record.isbn === isbn);
  if (!book) return empty("The Simon & Schuster page's book record does not carry this ISBN-13.");
  const pageImage = meta(html, "og:image");
  if (!pageImage) return empty("The Simon & Schuster page has no cover image.");

  // Largest size first; fall back to the size the page itself shows.
  const tried: string[] = [];
  for (const suffix of ["_hr", "_lg"] as const) {
    const imageUrl = simonSchusterSizedCover(pageImage, isbn, suffix);
    if (!imageUrl || tried.includes(imageUrl)) continue;
    tried.push(imageUrl);
    const image = await fetchImpl(imageUrl, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000), headers: { ...HEADERS, Accept: "image/*" } });
    if (!image.ok) continue;
    const bytes = new Uint8Array(await image.arrayBuffer());
    if (bytes.byteLength < 5_000 || !looksLikeImage(bytes)) continue;
    const canonical = `${finalUrl.origin}${finalUrl.pathname}`;
    return { candidates: [{
      sourceName: "Simon & Schuster" as const,
      externalId: canonical,
      coverImageUrl: imageUrl,
      sourceRecordUrl: canonical,
      candidateTitle: book.name,
      candidatePublisher: null,
      candidateLanguage: "English",
      candidateIsbn13: isbn,
      matchScore: 88,
      matchConfidence: "strong" as const,
      matchReasons: ["Simon & Schuster product page (publisher's distributor)", "The page's book record carries this edition's exact ISBN-13"],
      rawPayload: { importer: "simon_schuster_isbn", lookup_url: lookupUrl, target_isbn_13: isbn, source_isbn_13: isbn, size: suffix },
    }] };
  }
  return empty(tried.length ? "The Simon & Schuster cover image could not be downloaded." : "The Simon & Schuster cover is not on its own image server for this ISBN.");
}
