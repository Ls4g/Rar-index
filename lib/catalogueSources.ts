export type CatalogueSourceCandidate = {
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

function normaliseDate(value: string | undefined) {
  if (!value) return null;
  const fullDate = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (fullDate) return `${fullDate[1]}-${fullDate[2]}-${fullDate[3]}`;
  const year = value.match(/(?:^|\D)(\d{4})(?:\D|$)/)?.[1];
  return year ? `${year}-01-01` : null;
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
      candidate_release_date: normaliseDate(xmlValues(record, "dc:date")[0]),
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
        external_id: externalId,
        source_record_url: `https://openlibrary.org/books/${externalId}`,
        raw_payload: { importer: "open_library", query, source_record: record, selected_edition: edition },
        candidate_kind: "edition_candidate" as const,
        candidate_title: title,
        candidate_author: stringArray(record.author_name)[0] || null,
        candidate_publisher: publishers[0] || null,
        candidate_language: languageName(languages[0]),
        candidate_isbn_13: isbn13FromValues(isbns),
        candidate_release_date: normaliseDate(publishDate),
        candidate_cover_image_url: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : null,
      }];
    });
  });

  return candidates.filter((candidate, index, all) => all.findIndex((item) => item.external_id === candidate.external_id) === index);
}
