import { assessCoverCandidate, normalizeIsbn, type CoverMatchTarget } from "@/lib/coverCandidateMatch";

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
};

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

async function findGoogleBooks(target: CoverMatchTarget): Promise<DiscoveredCoverCandidate[]> {
  const isbn = normalizeIsbn(target.isbn13);
  if (!isbn) return [];
  const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=10&projection=full`, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "RAR-Index-Cover-Research/1.0" },
  });
  if (!response.ok) throw new Error(`Google Books returned ${response.status}`);
  const payload = await response.json() as { items?: GoogleVolume[] };
  return (payload.items ?? []).flatMap((volume) => {
    const info = volume.volumeInfo ?? {};
    const candidateIsbn = normalizeIsbn(info.industryIdentifiers?.find((entry) => entry.type === "ISBN_13")?.identifier);
    const coverImageUrl = googleImage(volume);
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

async function findOpenLibrary(target: CoverMatchTarget): Promise<DiscoveredCoverCandidate[]> {
  const isbn = normalizeIsbn(target.isbn13);
  if (!isbn) return [];
  const bibKey = `ISBN:${isbn}`;
  const response = await fetch(`https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(bibKey)}&format=json&jscmd=data`, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "RAR-Index-Cover-Research/1.0 (catalogue cover review)" },
  });
  if (!response.ok) throw new Error(`Open Library returned ${response.status}`);
  const payload = await response.json() as Record<string, OpenLibraryBook>;
  const book = payload[bibKey];
  if (!book) return [];
  const candidateIsbn = normalizeIsbn(book.identifiers?.isbn_13?.[0] ?? isbn);
  const coverImageUrl = secureImageUrl(book.cover?.large ?? book.cover?.medium ?? book.cover?.small);
  const sourceRecordUrl = book.url ? new URL(book.url, "https://openlibrary.org").toString() : `https://openlibrary.org/isbn/${isbn}`;
  const candidateLanguage = book.languages?.[0]?.key?.split("/").pop() ?? null;
  const assessment = assessCoverCandidate(target, {
    title: book.title ?? null,
    publisher: book.publishers?.[0]?.name ?? null,
    language: candidateLanguage,
    isbn13: candidateIsbn,
  });
  if (!coverImageUrl || !assessment.eligible) return [];
  return [{
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
    matchReasons: assessment.reasons,
    rawPayload: book as Record<string, unknown>,
  }];
}

export async function discoverCoverCandidates(target: CoverMatchTarget): Promise<CoverDiscoveryResult> {
  const results = await Promise.allSettled([findGoogleBooks(target), findOpenLibrary(target)]);
  const candidates: DiscoveredCoverCandidate[] = [];
  const errors: string[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") candidates.push(...result.value);
    else errors.push(result.reason instanceof Error ? result.reason.message : "A cover source could not be checked");
  }
  const unique = new Map(candidates.map((candidate) => [`${candidate.sourceName}:${candidate.externalId}`, candidate]));
  return { candidates: [...unique.values()], errors };
}
