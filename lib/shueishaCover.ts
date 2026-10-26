import { assessCoverCandidate, normalizeIsbn, type CoverMatchTarget } from "./coverCandidateMatch.ts";
import { isbnAddressableCover, looksLikeImage } from "./vizCover.ts";

// RAR already uses this Shueisha image path for verified Japanese covers.
// The filename is the physical book's ISBN-13; a missing file returns 403.
const SHUEISHA_IMAGE_HOST = "https://dosbg3xlm0x1t.cloudfront.net/images/items";
const MIN_COVER_BYTES = 5_000;

export function shueishaCoverImageUrl(isbn13: string | null | undefined, size: 500 | 240 = 500) {
  const isbn = normalizeIsbn(isbn13);
  if (!/^97[89]\d{10}$/.test(isbn)) return null;
  const checksum = [...isbn].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0);
  if (checksum % 10 !== 0) return null;
  return `${SHUEISHA_IMAGE_HOST}/${isbn}/${size}/${isbn}.jpg`;
}

function shueishaPublisher(value: string | null) {
  return /(?:^|\b)shueisha(?:\b|$)|集英社/i.test(value ?? "");
}

async function checkImage(url: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: { Accept: "image/*", "User-Agent": "RAR-Index-Cover-Research/1.0 (catalogue cover review)" },
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (response.status === 403 || response.status === 404) return false;
  if (!response.ok) throw new Error(`Shueisha image CDN returned ${response.status}`);
  const body = new Uint8Array(await response.arrayBuffer());
  return body.byteLength >= MIN_COVER_BYTES && looksLikeImage(body);
}

export async function findShueishaCover(target: CoverMatchTarget, fetchImpl: typeof fetch = fetch) {
  const empty = (emptyReason: string) => ({ candidates: [], emptyReason });
  if (!shueishaPublisher(target.publisher) || !/^(?:ja|jpn|japanese)$/i.test(target.language?.trim() ?? "")) {
    return empty("Only Japanese Shueisha editions can use this cover source.");
  }
  const addressable = isbnAddressableCover(target);
  if (!addressable.usable) return empty(addressable.reason ?? "This edition needs a distinct cover source.");

  const isbn = normalizeIsbn(target.isbn13);
  const largeUrl = shueishaCoverImageUrl(isbn);
  if (!largeUrl) return empty("A valid ISBN-13 is required for Shueisha's image catalogue.");
  let imageUrl: string | null = await checkImage(largeUrl, fetchImpl) ? largeUrl : null;
  if (!imageUrl) {
    const smallUrl = shueishaCoverImageUrl(isbn, 240)!;
    if (await checkImage(smallUrl, fetchImpl)) imageUrl = smallUrl;
  }
  if (!imageUrl) return empty("Shueisha has no usable image for this ISBN.");

  // The product HTML may refuse automated requests. Do not copy RAR's own
  // title/language back as if Shueisha confirmed them; a human checks the
  // official product page and artwork before approving this candidate.
  const assessment = assessCoverCandidate(target, {
    title: null, language: null, publisher: "Shueisha", isbn13: isbn,
  });
  if (!assessment.eligible) return empty(`The Shueisha image conflicts with this edition: ${assessment.conflicts.join("; ")}.`);

  const formattedIsbn = `${isbn.slice(0, 3)}-${isbn.slice(3, 4)}-${isbn.slice(4, 6)}-${isbn.slice(6, 12)}-${isbn.slice(12)}`;
  return { candidates: [{
    sourceName: "Shueisha Direct" as const,
    externalId: isbn,
    coverImageUrl: imageUrl,
    sourceRecordUrl: `https://books.shueisha.co.jp/items/contents.html?isbn=${formattedIsbn}`,
    candidateTitle: null,
    candidatePublisher: "Shueisha",
    candidateLanguage: null,
    candidateIsbn13: isbn,
    matchScore: assessment.score,
    matchConfidence: assessment.confidence as "strong" | "partial",
    matchReasons: [
      ...assessment.reasons,
      "Image located on Shueisha's ISBN-addressed cover CDN. Confirm its artwork and official book record before approval.",
    ],
    rawPayload: { importer: "shueisha_cover_cdn", isbn_13: isbn, image_url: imageUrl, product_html_checked: false },
  }] };
}
