export type CatalogueSourceCandidate = {
  source_name?: "Open Library" | "Shueisha Direct" | "OpenBD";
  external_id: string;
  source_record_url: string;
  raw_payload: Record<string, unknown>;
  candidate_kind: "edition_candidate";
  candidate_title: string;
  candidate_series?: string | null;
  candidate_volume_number?: string | null;
  candidate_author: string | null;
  candidate_publisher: string | null;
  candidate_language: string | null;
  candidate_isbn_13: string | null;
  candidate_release_date: string | null;
  candidate_format?: string | null;
  candidate_cover_image_url?: string | null;
};

type OpenBdRecord = {
  summary?: {
    isbn?: string;
    title?: string;
    volume?: string;
    series?: string;
    publisher?: string;
    pubdate?: string;
    cover?: string;
    author?: string;
  };
  onix?: {
    RecordReference?: string;
    DescriptiveDetail?: {
      ProductFormDetail?: string;
      Language?: Array<{ LanguageCode?: string }>;
    };
  };
  hanmoto?: Record<string, unknown>;
};

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlValues(xml: string, tag: string) {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "g"))]
    .map((match) => decodeHtml(match[1]))
    .filter(Boolean);
}

function cleanIsbn(value: string) {
  return value.replace(/[^0-9Xx]/g, "").toUpperCase();
}

function isbn13From10(isbn10: string) {
  if (!/^\d{9}[\dX]$/.test(isbn10)) return null;
  const firstTwelve = `978${isbn10.slice(0, 9)}`;
  const total = [...firstTwelve].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${firstTwelve}${(10 - (total % 10)) % 10}`;
}

function isbn13FromValues(values: string[]) {
  for (const value of values.map(cleanIsbn)) {
    if (/^97[89]\d{10}$/.test(value)) return value;
    const converted = isbn13From10(value);
    if (converted) return converted;
  }
  return null;
}

function languageName(value: string | undefined) {
  const code = value?.split("/").at(-1)?.toLowerCase();
  if (code === "eng" || code === "en") return "English";
  if (code === "jpn" || code === "ja") return "Japanese";
  return value || null;
}

const MONTH_NUMBER: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10,
  october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function exactDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// The catalogue schema currently has a date, not a date plus a precision
// field. Returning January 1 for a source that only says "2005" invents a
// day and month and makes the public edition page state it as fact. Keep
// partial dates null until RAR has an exact date from a source.
export function normaliseCatalogueDate(value: string | undefined) {
  const clean = value?.trim();
  if (!clean) return null;

  const iso = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return exactDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const monthFirst = clean.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})$/i);
  if (monthFirst) {
    const month = MONTH_NUMBER[monthFirst[1].toLowerCase()];
    return month ? exactDate(Number(monthFirst[3]), month, Number(monthFirst[2])) : null;
  }

  const dayFirst = clean.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)[,]?\s+(\d{4})$/i);
  if (dayFirst) {
    const month = MONTH_NUMBER[dayFirst[2].toLowerCase()];
    return month ? exactDate(Number(dayFirst[3]), month, Number(dayFirst[1])) : null;
  }

  return null;
}

function htmlMatch(html: string, pattern: RegExp) {
  return decodeHtml(html.match(pattern)?.[1] || "") || null;
}

function openBdDate(value: string | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 8) return exactDate(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8)));
  return null;
}

export async function searchOpenBdCatalogue(query: string): Promise<CatalogueSourceCandidate[]> {
  const isbn = cleanIsbn(query);
  if (!/^\d{9}[\dX]$/.test(isbn) && !/^97[89]\d{10}$/.test(isbn)) {
    throw new Error("OpenBD needs a Japanese ISBN-10 or ISBN-13, not a title search.");
  }
  const isbn13 = isbn.length === 10 ? isbn13From10(isbn) : isbn;
  if (!isbn13) throw new Error("That ISBN could not be read.");

  const sourceRecordUrl = `https://api.openbd.jp/v1/get?isbn=${encodeURIComponent(isbn13)}`;
  const response = await fetch(sourceRecordUrl, {
    headers: { Accept: "application/json", "User-Agent": "RAR-Index catalogue curator" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`OpenBD returned ${response.status}.`);
  const payload = await response.json() as Array<OpenBdRecord | null>;
  const record = payload[0];
  if (!record) return [];

  const summary = record.summary ?? {};
  const returnedIsbn = cleanIsbn(summary.isbn ?? record.onix?.RecordReference ?? "");
  const returnedIsbn13 = returnedIsbn.length === 10 ? isbn13From10(returnedIsbn) : returnedIsbn;
  if (returnedIsbn13 !== isbn13) return [];
  const title = summary.title?.trim();
  if (!title) return [];

  const languageCode = record.onix?.DescriptiveDetail?.Language?.[0]?.LanguageCode;
  return [{
    source_name: "OpenBD",
    external_id: isbn13,
    source_record_url: sourceRecordUrl,
    raw_payload: { importer: "openbd", isbn_query: isbn, source_record: record },
    candidate_kind: "edition_candidate",
    candidate_title: title,
    candidate_series: summary.series?.trim() || null,
    candidate_volume_number: summary.volume?.trim() || null,
    candidate_author: summary.author?.trim() || null,
    candidate_publisher: summary.publisher?.trim() || null,
    candidate_language: languageName(languageCode),
    candidate_isbn_13: isbn13,
    candidate_release_date: openBdDate(summary.pubdate),
    candidate_format: record.onix?.DescriptiveDetail?.ProductFormDetail ?? null,
    candidate_cover_image_url: summary.cover?.replace(/^http:\/\//i, "https://") || null,
  }];
}

export async function searchShueishaCatalogue(query: string): Promise<CatalogueSourceCandidate[]> {
  const isbn = cleanIsbn(query);
  if (!/^\d{9}[\dX]$/.test(isbn) && !/^97[89]\d{10}$/.test(isbn)) {
    throw new Error("Shueisha Direct needs a Japanese ISBN-10 or ISBN-13, not a title search.");
  }
  const isbn13 = isbn.length === 10 ? isbn13From10(isbn) : isbn;
  if (!isbn13) throw new Error("That ISBN could not be read.");

  const formattedIsbn = `${isbn13.slice(0, 3)}-${isbn13.slice(3, 4)}-${isbn13.slice(4, 6)}-${isbn13.slice(6, 12)}-${isbn13.slice(12)}`;
  const sourceRecordUrl = `https://books.shueisha.co.jp/items/contents.html?isbn=${formattedIsbn}`;
  const response = await fetch(sourceRecordUrl, {
    headers: { "User-Agent": "RAR-Index catalogue curator" },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Shueisha did not return a usable record.");
  const html = await response.text();
  const sourceIsbn = cleanIsbn(htmlMatch(html, /ISBN[：:]\s*([0-9Xx-]+)/) || "");
  if (!sourceIsbn || (sourceIsbn !== isbn && isbn13From10(sourceIsbn) !== isbn13 && sourceIsbn !== isbn13)) return [];
  const release = html.match(/(\d{4})年(\d{1,2})月(\d{1,2})日発売/);
  const title = htmlMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)
    || htmlMatch(html, /<title[^>]*>([\s\S]*?)<\//i)?.split(/[／|]/)[0]?.trim();
  if (!title) return [];

  return [{
    source_name: "Shueisha Direct",
    external_id: isbn13,
    source_record_url: sourceRecordUrl,
    raw_payload: { importer: "shueisha_direct", isbn_query: isbn, source_html: html },
    candidate_kind: "edition_candidate",
    candidate_title: title,
    candidate_author: htmlMatch(html, /著者[：:]?\s*<[^>]*>([\s\S]*?)<\//),
    candidate_publisher: "Shueisha",
    candidate_language: "Japanese",
    candidate_isbn_13: isbn13,
    candidate_release_date: release ? `${release[1]}-${release[2].padStart(2, "0")}-${release[3].padStart(2, "0")}` : null,
    candidate_format: htmlMatch(html, /(新書判|B6判|A5判|文庫判)[／/]/),
  }];
}

export async function searchNdlCatalogue(query: string): Promise<CatalogueSourceCandidate[]> {
  const isbn = cleanIsbn(query);
  const params = new URLSearchParams({
    cnt: "50",
    dpid: "iss-ndl-opac",
    mediatype: "books",
  });
  if (/^\d{9}[\dX]$/.test(isbn) || /^97[89]\d{10}$/.test(isbn)) params.set("isbn", isbn);
  else params.set("title", query.replace(/[\"]/g, ""));
  const searchUrl = `https://ndlsearch.ndl.go.jp/api/opensearch?${params.toString()}`;
  const response = await fetch(searchUrl, {
    headers: { "User-Agent": "RAR-Index catalogue curator" },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("National Diet Library Search did not return a usable response.");
  const xml = await response.text();

  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap((match, index) => {
    const record = match[1];
    const title = xmlValues(record, "dc:title")[0];
    const identifiers = xmlValues(record, "dc:identifier");
    const candidateIsbn = isbn13FromValues(identifiers);
    const recordUrl = xmlValues(record, "link")[0] || xmlValues(record, "guid")[0];
    const recordId = recordUrl?.match(/\/books\/([^/?#]+)/)?.[1]
      || `result-${index + 1}`;
    if (!title) return [];

    return [{
      external_id: recordId,
      source_record_url: recordUrl || searchUrl,
      raw_payload: { importer: "ndl_search", query, record_xml: record },
      candidate_kind: "edition_candidate" as const,
      candidate_title: title,
      candidate_series: xmlValues(record, "dcndl:seriesTitle")[0] || null,
      candidate_volume_number: xmlValues(record, "dcndl:volume")[0] || null,
      candidate_author: xmlValues(record, "dc:creator")[0] || null,
      candidate_publisher: xmlValues(record, "dc:publisher")[0] || null,
      candidate_language: languageName(xmlValues(record, "dc:language")[0]),
      candidate_isbn_13: candidateIsbn,
      candidate_release_date: normaliseCatalogueDate(xmlValues(record, "dc:date")[0]),
      candidate_format: xmlValues(record, "dcndl:genre")[0] || null,
    }];
  });
}

type OpenLibraryRecord = Record<string, unknown> & { docs?: OpenLibraryRecord[] };

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function searchOpenLibraryCatalogue(query: string): Promise<CatalogueSourceCandidate[]> {
  const fields = [
    "key", "title", "author_name", "publisher", "language", "first_publish_year", "isbn", "cover_i",
    "editions", "editions.key", "editions.title", "editions.publisher", "editions.isbn", "editions.publish_date", "editions.language", "editions.cover_i",
  ].join(",");
  const searchUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&limit=10`;
  const response = await fetch(searchUrl, {
    headers: { "User-Agent": "RAR-Index catalogue curator" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Open Library did not return a usable response.");
  const payload = await response.json() as { docs?: OpenLibraryRecord[] };

  const candidates = (payload.docs ?? []).flatMap((record) => {
    const editionRecords = (record.editions as OpenLibraryRecord | undefined)?.docs?.slice(0, 5) ?? [];
    const editions = editionRecords.length ? editionRecords : [record];
    return editions.flatMap((edition) => {
      const externalId = String(edition.key || record.key || "").replace("/books/", "").replace("/works/", "");
      const title = String(edition.title || record.title || "").trim();
      if (!externalId || !title) return [];
      const languages = stringArray(edition.language).length ? stringArray(edition.language) : stringArray(record.language);
      const isbns = stringArray(edition.isbn).length ? stringArray(edition.isbn) : stringArray(record.isbn);
      const publishers = stringArray(edition.publisher).length ? stringArray(edition.publisher) : stringArray(record.publisher);
      const publishDate = String(edition.publish_date || record.first_publish_year || "");
      const coverId = edition.cover_i || record.cover_i;

      return [{
        source_name: "Open Library" as const,
        external_id: externalId,
        source_record_url: `https://openlibrary.org/books/${externalId}`,
        raw_payload: { importer: "open_library", query, source_record: record, selected_edition: edition },
        candidate_kind: "edition_candidate" as const,
        candidate_title: title,
        candidate_author: stringArray(record.author_name)[0] || null,
        candidate_publisher: publishers[0] || null,
        candidate_language: languageName(languages[0]),
        candidate_isbn_13: isbn13FromValues(isbns),
        candidate_release_date: normaliseCatalogueDate(publishDate),
        candidate_cover_image_url: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : null,
      }];
    });
  });

  return candidates.filter((candidate, index, all) => all.findIndex((item) => item.external_id === candidate.external_id) === index);
}
