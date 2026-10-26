import { searchOpenBdCatalogue } from "./catalogueSources.ts";
import { assessCoverCandidate, normalizeIsbn, type CoverMatchTarget } from "./coverCandidateMatch.ts";
import { isbnAddressableCover } from "./vizCover.ts";

export async function findOpenBdCover(target: CoverMatchTarget, lookup = searchOpenBdCatalogue) {
  const empty = (emptyReason: string) => ({ candidates: [], emptyReason });
  if (!/^(?:ja|jpn|japanese)$/i.test(target.language?.trim() ?? "")) {
    return empty("OpenBD is checked for Japanese editions only.");
  }
  const addressable = isbnAddressableCover(target);
  if (!addressable.usable) return empty(addressable.reason ?? "This edition needs a distinct cover source.");
  const isbn = normalizeIsbn(target.isbn13);
  if (!/^97[89]\d{10}$/.test(isbn)) return empty("A Japanese ISBN-13 is required for OpenBD.");

  const records = await lookup(isbn);
  const record = records.find((item) => normalizeIsbn(item.candidate_isbn_13) === isbn);
  if (!record) return empty("OpenBD has no exact-ISBN book record.");
  const image = record.candidate_cover_image_url;
  if (!image) return empty("The exact-ISBN OpenBD record has no cover image.");
  let imageUrl: URL;
  try { imageUrl = new URL(image); }
  catch { return empty("The OpenBD cover URL is invalid."); }
  if (imageUrl.protocol !== "https:") return empty("OpenBD did not supply a secure cover URL.");
  const assessment = assessCoverCandidate(target, {
    title: record.candidate_title, publisher: record.candidate_publisher,
    language: record.candidate_language, isbn13: record.candidate_isbn_13,
  });
  if (!assessment.eligible) return empty(`The OpenBD record conflicts with this edition: ${assessment.conflicts.join("; ")}.`);

  return { candidates: [{
    sourceName: "OpenBD" as const,
    externalId: isbn,
    coverImageUrl: imageUrl.toString(),
    sourceRecordUrl: record.source_record_url,
    candidateTitle: record.candidate_title,
    candidatePublisher: record.candidate_publisher,
    candidateLanguage: record.candidate_language,
    candidateIsbn13: isbn,
    matchScore: assessment.score,
    matchConfidence: assessment.confidence as "strong" | "partial",
    matchReasons: [...assessment.reasons, "Cover linked from OpenBD's exact-ISBN record; verify the artwork before approval."],
    rawPayload: { importer: "openbd_cover_isbn", source_record_url: record.source_record_url },
  }] };
}
