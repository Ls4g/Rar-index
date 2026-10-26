import { assessCoverCandidate, normalizeIsbn, type CoverMatchTarget } from "./coverCandidateMatch.ts";
import { isbnAddressableCover, looksLikeImage } from "./vizCover.ts";

const MIN_COVER_BYTES = 5_000;

function meta(html: string, property: string) {
  const tag = html.match(new RegExp(`<meta\\b(?=[^>]*property=["']${property}["'])[^>]*>`, "i"))?.[0];
  return tag?.match(/content=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, "&") ?? null;
}

export async function findPenguinRandomHouseCover(target: CoverMatchTarget, fetchImpl: typeof fetch = fetch) {
  const empty = (emptyReason: string) => ({ candidates: [], emptyReason });
  if (!/^(?:en|eng|english)$/i.test(target.language?.trim() ?? "")) {
    return empty("Penguin Random House's US catalogue is checked for English editions only.");
  }
  const addressable = isbnAddressableCover(target);
  if (!addressable.usable) return empty(addressable.reason ?? "This edition needs a distinct cover source.");
  const isbn = normalizeIsbn(target.isbn13);
  if (!/^97[89]\d{10}$/.test(isbn)) return empty("An ISBN-13 is required for publisher-distributor search.");

  const searchUrl = `https://www.penguinrandomhouse.com/search/site?q=${isbn}`;
  const page = await fetchImpl(searchUrl, {
    cache: "no-store", signal: AbortSignal.timeout(15_000),
    headers: { Accept: "text/html", "User-Agent": "RAR-Index-Cover-Research/1.0 (catalogue cover review)" },
  });
  if (!page.ok) throw new Error(`Penguin Random House returned ${page.status}`);
  const recordUrl = new URL(page.url);
  if (recordUrl.protocol !== "https:" || recordUrl.hostname !== "www.penguinrandomhouse.com"
    || !/^\/books\/\d+\/[^/]+\/97[89]\d{10}\/?$/.test(recordUrl.pathname)
    || recordUrl.pathname.split("/").filter(Boolean).at(-1) !== isbn) {
    return empty("No exact-ISBN Penguin Random House product record was found.");
  }

  const html = await page.text();
  const ogTitle = meta(html, "og:title");
  const imageValue = meta(html, "og:image");
  const candidateTitle = ogTitle?.split(`: ${isbn}`)[0]?.trim() ?? null;
  if (!ogTitle?.includes(isbn) || !candidateTitle || !imageValue) {
    return empty("The product record lacks an exact ISBN, title, or cover image.");
  }
  let imageUrl: URL;
  try { imageUrl = new URL(imageValue); }
  catch { return empty("The product record's image URL is invalid."); }
  if (imageUrl.protocol !== "https:" || !/^images\d*\.penguinrandomhouse\.com$/.test(imageUrl.hostname)
    || !imageUrl.pathname.endsWith(`/${isbn}`)) {
    return empty("The product record image is not an ISBN-addressed PRH image.");
  }
  const assessment = assessCoverCandidate(target, {
    title: candidateTitle, publisher: null, language: null, isbn13: isbn,
  });
  if (!assessment.eligible) return empty(`The product record conflicts with this edition: ${assessment.conflicts.join("; ")}.`);

  const image = await fetchImpl(imageUrl.toString(), {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
    headers: { Accept: "image/*", "User-Agent": "RAR-Index-Cover-Research/1.0 (catalogue cover review)" },
  });
  if (!image.ok) return empty(`The product cover returned HTTP ${image.status}.`);
  const bytes = new Uint8Array(await image.arrayBuffer());
  if (bytes.byteLength < MIN_COVER_BYTES || !looksLikeImage(bytes)) return empty("The product image is missing or is not cover art.");

  return { candidates: [{
    sourceName: "Penguin Random House" as const,
    externalId: isbn,
    coverImageUrl: imageUrl.toString(),
    sourceRecordUrl: recordUrl.toString(),
    candidateTitle,
    candidatePublisher: null,
    candidateLanguage: null,
    candidateIsbn13: isbn,
    matchScore: assessment.score,
    matchConfidence: assessment.confidence as "strong" | "partial",
    matchReasons: [...assessment.reasons, "Exact-ISBN distributor product page; confirm its artwork and publisher before approval."],
    rawPayload: { importer: "prh_isbn_search", query_isbn_13: isbn, product_url: recordUrl.toString() },
  }] };
}
