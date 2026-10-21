import { assessCoverCandidate, normalizeIsbn, type CoverMatchTarget } from "./coverCandidateMatch.ts";

// VIZ cover art, addressed by ISBN.
//
// Why this exists. RAR's cover finder had two providers and only one of them
// had ever run: Google Books is skipped on every scan because no API key is
// configured, leaving Open Library as the sole source. Open Library supplied
// 157 of 171 covers but carries nothing for recent releases -- 18 coverless
// editions were scanned between 1 and 9 October 2026 and every one came back
// empty. VIZ publishes 110 of RAR's 235 editions and could not be asked at
// all, so for a VIZ book Open Library lacks, RAR had nowhere left to look.
//
// What makes this cheap. VIZ serves every product image from one CDN path
// named after the book's ISBN-10:
//
//   https://dw9to29mmj727.cloudfront.net/products/<isbn10>.jpg
//
// ISBN-10 is derivable from ISBN-13 arithmetically, so no search, no HTML
// parsing, no API key and no rate limit is involved -- one conditional GET per
// edition. This was not guessed: 30 of the 32 VIZ covers RAR already holds are
// served from that exact host, and every one of their filenames is the ISBN-10
// of its edition.
//
// It is also self-limiting in a useful way. The CDN answers 403 for an ISBN
// VIZ does not publish, so a Yen Press or Kodansha book simply yields nothing
// rather than a wrong image. Measured across the 19 coverless editions holding
// an ISBN: all 10 VIZ titles returned a cover, and all 9 non-VIZ titles
// returned 403.

export const VIZ_PRODUCT_IMAGE_HOST = "https://dw9to29mmj727.cloudfront.net/products";

// A real cover is well over 100KB. A tiny 200 response would be a placeholder
// or an error page, and must not be offered as cover art.
const MIN_COVER_BYTES = 5_000;

/**
 * ISBN-10 from ISBN-13.
 *
 * Only defined for the 978 prefix. A 979 ISBN -- increasingly common on new
 * releases, and the reason Gachiakuta vol 2 cannot be looked up this way -- has
 * no ISBN-10 equivalent at all, so this returns null rather than computing a
 * number that addresses nothing.
 */
export function isbn10FromIsbn13(isbn13: string | null | undefined) {
  const digits = (isbn13 ?? "").replace(/[^0-9]/g, "");
  if (digits.length !== 13 || !digits.startsWith("978")) return null;
  const core = digits.slice(3, 12);
  let sum = 0;
  for (let index = 0; index < 9; index += 1) sum += Number(core[index]) * (10 - index);
  const check = (11 - (sum % 11)) % 11;
  return `${core}${check === 10 ? "X" : check}`;
}

/**
 * Whether these bytes actually begin an image.
 *
 * Checked instead of the content-type header, which this CDN does not set
 * reliably. The three signatures cover what VIZ serves; anything else -- an
 * HTML error page, a redirect body, an empty file -- fails.
 */
export function looksLikeImage(bytes: Uint8Array) {
  if (bytes.byteLength < 12) return false;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return jpeg || png || webp;
}

export function vizCoverImageUrl(isbn13: string | null | undefined) {
  const isbn10 = isbn10FromIsbn13(isbn13);
  return isbn10 ? `${VIZ_PRODUCT_IMAGE_HOST}/${isbn10}.jpg` : null;
}

/**
 * Whether an ISBN-addressed image could possibly be right for this edition.
 *
 * A variant or a specific printing shares its ISBN with the plain edition --
 * three of RAR's ISBNs carry two editions for exactly that reason. The Gold
 * Foil One Piece vol 1 is the case in point: its whole identity is that its
 * cover looks different, and an ISBN lookup can only ever return the ordinary
 * cover. Offering it would put a knowingly wrong image in front of a reviewer
 * and invite them to approve it, so this declines instead. Those editions need
 * a photograph of a real copy.
 */
export function isbnAddressableCover(target: CoverMatchTarget) {
  if (target.variantName?.trim()) {
    return { usable: false, reason: `This is the "${target.variantName.trim()}" variant, which shares its ISBN with the plain edition. An ISBN lookup can only return the ordinary cover, so it needs a photograph of a real copy instead.` };
  }
  if (typeof target.printingNumber === "number" && target.printingNumber > 1) {
    return { usable: false, reason: `This is printing ${target.printingNumber}, which shares its ISBN with the first printing. An ISBN lookup cannot tell the printings apart.` };
  }
  return { usable: true, reason: null };
}

export type VizCoverCheck = {
  coverImageUrl: string | null;
  isbn10: string | null;
  emptyReason?: string;
};

/**
 * One conditional GET. Returns an image URL only when VIZ actually serves a
 * real image for that ISBN.
 */
export async function findVizCoverImage(isbn13: string | null | undefined, fetchImpl = fetch): Promise<VizCoverCheck> {
  const isbn10 = isbn10FromIsbn13(isbn13);
  if (!isbn10) {
    return {
      coverImageUrl: null,
      isbn10: null,
      emptyReason: normalizeIsbn(isbn13)
        ? "VIZ addresses covers by ISBN-10, which only exists for 978-prefixed ISBNs."
        : "No ISBN is available for VIZ.",
    };
  }
  const url = `${VIZ_PRODUCT_IMAGE_HOST}/${isbn10}.jpg`;
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: { Accept: "image/*", "User-Agent": "RAR-Index-Cover-Research/1.0 (catalogue cover review)" },
  });
  if (response.status === 403 || response.status === 404) {
    return { coverImageUrl: null, isbn10, emptyReason: "VIZ does not publish this ISBN, so its product CDN has no image for it." };
  }
  if (!response.ok) throw new Error(`VIZ product CDN returned ${response.status}`);

  // The bytes are inspected rather than the content-type header, because this
  // CDN does not label its images reliably: it serves genuine JPEGs as
  // "binary/octet-stream" and sometimes with no content type at all. Trusting
  // the header rejected all ten real covers. Reading the magic number is both
  // the accurate test and the stricter one -- an HTML error page cannot forge
  // a JPEG signature.
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength < MIN_COVER_BYTES) {
    return { coverImageUrl: null, isbn10, emptyReason: `The VIZ product CDN returned only ${body.byteLength} bytes, too small to be cover art.` };
  }
  if (!looksLikeImage(body)) {
    return { coverImageUrl: null, isbn10, emptyReason: "The VIZ product CDN returned something that is not an image." };
  }
  return { coverImageUrl: url, isbn10 };
}

export type VizProviderCheck = {
  candidates: Array<{
    sourceName: "VIZ Media";
    externalId: string;
    coverImageUrl: string;
    sourceRecordUrl: string;
    candidateTitle: string | null;
    candidatePublisher: string | null;
    candidateLanguage: string | null;
    candidateIsbn13: string;
    matchScore: number;
    matchConfidence: "strong" | "partial";
    matchReasons: string[];
    rawPayload: Record<string, unknown>;
  }>;
  emptyReason?: string;
};

export async function findVizCover(target: CoverMatchTarget, fetchImpl = fetch): Promise<VizProviderCheck> {
  const addressable = isbnAddressableCover(target);
  if (!addressable.usable) return { candidates: [], emptyReason: addressable.reason ?? undefined };

  const isbn = normalizeIsbn(target.isbn13);
  const check = await findVizCoverImage(target.isbn13, fetchImpl);
  if (!check.coverImageUrl) return { candidates: [], emptyReason: check.emptyReason };

  // The candidate's ISBN is the target's own, because the image was addressed
  // by it -- so the exact-ISBN check passes by construction and nothing here
  // can smuggle in a different book. Publisher is asserted as VIZ on the
  // evidence that VIZ's own product CDN served the file and refuses ISBNs it
  // does not publish. Title and language are left null rather than copied from
  // the target, which would be scoring RAR's own data as if a source had
  // confirmed it.
  const assessment = assessCoverCandidate(target, {
    title: null,
    publisher: "VIZ Media",
    language: null,
    isbn13: isbn,
  });
  if (!assessment.eligible) {
    return { candidates: [], emptyReason: `The VIZ image conflicts with this edition: ${assessment.conflicts.join("; ") || "insufficient metadata"}.` };
  }

  // VIZ's own search does not index ISBNs, so there is no product page URL
  // derivable from one. A reviewer gets a series search, which is the closest
  // thing to a record they can actually open and compare against.
  const sourceRecordUrl = target.series?.trim() || target.title?.trim()
    ? `https://www.viz.com/search?search=${encodeURIComponent((target.series ?? target.title ?? "").trim())}`
    : check.coverImageUrl;

  return {
    candidates: [{
      sourceName: "VIZ Media",
      externalId: check.isbn10 ?? isbn,
      coverImageUrl: check.coverImageUrl,
      sourceRecordUrl,
      candidateTitle: null,
      candidatePublisher: "VIZ Media",
      candidateLanguage: null,
      candidateIsbn13: isbn,
      matchScore: assessment.score,
      matchConfidence: assessment.confidence as "strong" | "partial",
      matchReasons: [
        ...assessment.reasons,
        // Said plainly, because it is what the reviewer is being asked to
        // confirm: the file is the right ISBN's, but no VIZ record was read to
        // confirm the artwork shows this volume.
        `Located on VIZ's product CDN by ISBN-10 ${check.isbn10}. No VIZ product record was read, so check the artwork matches this volume.`,
      ],
      rawPayload: { isbn10: check.isbn10, isbn13: isbn, imageUrl: check.coverImageUrl, located_by: "isbn10_derivation" },
    }],
  };
}
