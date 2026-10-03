import { assessCoverCandidate, normalizeIsbn, type CoverMatchTarget } from "@/lib/coverCandidateMatch";
import { googleBooksRequestUrl, type GoogleBooksBatchGate } from "@/lib/coverProviderPolicy";
import { findDirectOpenLibraryCover } from "@/lib/openLibraryCover";

export type DiscoveredCoverCandidate = {
  sourceName: "Google Books" | "Open Library";
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
};

export type CoverDiscoveryResult = {
  candidates: DiscoveredCoverCandidate[];
  errors: string[];
  providerStates: Array<{
    sourceName: "Google Books" | "Open Library";
    status: "checked" | "skipped" | "rate_limited" | "failed";
    message?: string;
  }>;
};

type ProviderCheck = { candidates: DiscoveredCoverCandidate[]; emptyReason?: string };

type GoogleVolume = {
  id?: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    publisher?: string;
    language?: string;
    infoLink?: string;
    industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
    imageLinks?: Record<string, string>;
  };
};

function secureImageUrl(value: string | null | undefined) {
  return (value ?? "").replace(/^http:\/\//i, "https://").trim();
}

function googleImage(volume: GoogleVolume) {
  const images = volume.volumeInfo?.imageLinks ?? {};
  return secureImageUrl(images.extraLarge ?? images.large ?? images.medium ?? images.small ?? images.thumbnail ?? images.smallThumbnail);
}

async function findGoogleBooks(target: CoverMatchTarget, apiKey: string): Promise<ProviderCheck> {
  const isbn = normalizeIsbn(target.isbn13);
  if (!isbn) return { candidates: [], emptyReason: "No ISBN is available for Google Books." };
  const response = await fetch(googleBooksRequestUrl(isbn, apiKey), {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "RAR-Index-Cover-Research/1.0" },
  });
  if (!response.ok) throw new Error(`Google Books returned ${response.status}`);
  const payload = await response.json() as { items?: GoogleVolume[] };
  const items = payload.items ?? [];
  let exactRecordFound = false;
  let exactRecordHasImage = false;
  const candidates = items.flatMap((volume) => {
    const info = volume.volumeInfo ?? {};
    const candidateIsbn = normalizeIsbn(info.industryIdentifiers?.find((entry) => entry.type === "ISBN_13")?.identifier);
    const coverImageUrl = googleImage(volume);
    if (candidateIsbn === isbn) {
      exactRecordFound = true;
      if (coverImageUrl) exactRecordHasImage = true;
    }
    const sourceRecordUrl = info.infoLink ?? (volume.id ? `https://books.google.com/books?id=${encodeURIComponent(volume.id)}` : "");
    const title = [info.title, info.subtitle].filter(Boolean).join(": ") || null;
    const assessment = assessCoverCandidate(target, {
      title,
      publisher: info.publisher ?? null,
      language: info.language ?? null,
      isbn13: candidateIsbn,
    });
    if (!volume.id || !coverImageUrl || !sourceRecordUrl || !assessment.eligible) return [];
    return [{
      sourceName: "Google Books" as const,
      externalId: volume.id,
      coverImageUrl,
      sourceRecordUrl,
      candidateTitle: title,
      candidatePublisher: info.publisher ?? null,
      candidateLanguage: info.language ?? null,
      candidateIsbn13: candidateIsbn,
      matchScore: assessment.score,
      matchConfidence: assessment.confidence as "strong" | "partial",
      matchReasons: assessment.reasons,
      rawPayload: volume as Record<string, unknown>,
    }];
  });
  return {
    candidates,
    emptyReason: candidates.length ? undefined : !items.length
      ? "No book record was found for this ISBN."
      : !exactRecordFound
        ? "Book records were found, but none carried the exact ISBN."
        : !exactRecordHasImage
          ? "An exact-ISBN book record exists, but it has no cover image."
          : "An image exists, but its volume, language, or record link did not pass the exact-edition checks.",
  };
}

type OpenLibraryBook = {
  key?: string;
  title?: string;
  url?: string;
  cover?: { small?: string; medium?: string; large?: string };
  publishers?: Array<{ name?: string }>;
  identifiers?: { isbn_13?: string[]; openlibrary?: string[] };
  languages?: Array<{ key?: string }>;
};

async function findOpenLibrary(target: CoverMatchTarget): Promise<ProviderCheck> {
  const isbn = normalizeIsbn(target.isbn13);
  if (!isbn) return { candidates: [], emptyReason: "No ISBN is available for Open Library." };
  const bibKey = `ISBN:${isbn}`;
  const response = await fetch(`https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(bibKey)}&format=json&jscmd=data`, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "RAR-Index-Cover-Research/1.0 (catalogue cover review)" },
  });
  if (!response.ok) throw new Error(`Open Library returned ${response.status}`);
  const payload = await response.json() as Record<string, OpenLibraryBook>;
  const book = payload[bibKey];
  if (!book) return { candidates: [], emptyReason: "No book record was found for this ISBN." };
  const candidateIsbn = normalizeIsbn(book.identifiers?.isbn_13?.[0] ?? isbn);
  const sourceRecordUrl = book.url ? new URL(book.url, "https://openlibrary.org").toString() : `https://openlibrary.org/isbn/${isbn}`;
  const candidateLanguage = book.languages?.[0]?.key?.split("/").pop() ?? null;
  const assessment = assessCoverCandidate(target, {
    title: book.title ?? null,
    publisher: book.publishers?.[0]?.name ?? null,
    language: candidateLanguage,
    isbn13: candidateIsbn,
  });
  if (!assessment.eligible) return { candidates: [], emptyReason: `The book record conflicts with this exact edition: ${assessment.conflicts.join("; ") || "insufficient metadata"}.` };
  const coverImageUrl = secureImageUrl(book.cover?.large ?? book.cover?.medium ?? book.cover?.small)
    || await findDirectOpenLibraryCover(isbn);
  if (!coverImageUrl) return { candidates: [], emptyReason: "The book record exists, but neither Open Library image endpoint has a cover." };
  const directImage = !book.cover?.large && !book.cover?.medium && !book.cover?.small;
  return { candidates: [{
    sourceName: "Open Library",
    externalId: book.identifiers?.openlibrary?.[0] ?? book.key ?? isbn,
    coverImageUrl,
    sourceRecordUrl,
    candidateTitle: book.title ?? null,
    candidatePublisher: book.publishers?.[0]?.name ?? null,
    candidateLanguage,
    candidateIsbn13: candidateIsbn,
    matchScore: assessment.score,
    matchConfidence: assessment.confidence as "strong" | "partial",
    matchReasons: directImage ? [...assessment.reasons, "Direct ISBN image found despite missing book-record cover"] : assessment.reasons,
    rawPayload: book as Record<string, unknown>,
  }] };
}

export async function discoverCoverCandidates(target: CoverMatchTarget, googleBooksGate?: GoogleBooksBatchGate): Promise<CoverDiscoveryResult> {
  const candidates: DiscoveredCoverCandidate[] = [];
  const errors: string[] = [];
  const providerStates: CoverDiscoveryResult["providerStates"] = [];
  const jobs: Array<{ sourceName: "Google Books" | "Open Library"; promise: Promise<ProviderCheck> }> = [
    { sourceName: "Open Library", promise: findOpenLibrary(target) },
  ];
  if (googleBooksGate?.canRequest() && googleBooksGate.apiKey) {
    jobs.push({ sourceName: "Google Books", promise: findGoogleBooks(target, googleBooksGate.apiKey) });
  } else {
    const reason = googleBooksGate?.skipReason() ?? "not_configured";
    providerStates.push({
      sourceName: "Google Books",
      status: reason === "rate_limited" ? "rate_limited" : "skipped",
      message: reason === "rate_limited" ? "Paused for the rest of this batch after HTTP 429." : "Skipped because GOOGLE_BOOKS_API_KEY is not configured.",
    });
  }
  const results = await Promise.allSettled(jobs.map((job) => job.promise));
  results.forEach((result, index) => {
    const sourceName = jobs[index].sourceName;
    if (result.status === "fulfilled") {
      candidates.push(...result.value.candidates);
      providerStates.push({ sourceName, status: "checked", message: result.value.emptyReason });
      return;
    }
    const message = result.reason instanceof Error ? result.reason.message : "A cover source could not be checked";
    const rateLimited = sourceName === "Google Books" && message.includes("429");
    if (rateLimited) googleBooksGate?.recordStatus(429);
    errors.push(`${sourceName}: ${message}`);
    providerStates.push({ sourceName, status: rateLimited ? "rate_limited" : "failed", message });
  });
  if (googleBooksGate?.skipReason() === "rate_limited" && !providerStates.some((state) => state.sourceName === "Google Books")) {
    providerStates.push({ sourceName: "Google Books", status: "rate_limited", message: "Paused for the rest of this batch after HTTP 429." });
  }
  const unique = new Map(candidates.map((candidate) => [`${candidate.sourceName}:${candidate.externalId}`, candidate]));
  return { candidates: [...unique.values()], errors, providerStates };
}
