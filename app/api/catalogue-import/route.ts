import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type CatalogueSource = "open_library" | "mangadex" | "shueisha" | "ndl_search";

function isStaffRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  const username = process.env.RAR_REVIEW_USERNAME;
  const password = process.env.RAR_REVIEW_PASSWORD;

  if (!username || !password || !authorization?.startsWith("Basic ")) return false;

  try {
    const [providedUsername, providedPassword] = atob(authorization.slice(6)).split(":");
    return providedUsername === username && providedPassword === password;
  } catch {
    return false;
  }
}

function languageName(value: string | undefined) {
  if (value === "eng" || value === "en") return "English";
  if (value === "jpn" || value === "ja") return "Japanese";
  return value || null;
}

function firstTitle(values: Record<string, string> | undefined) {
  if (!values) return null;
  return values.en || values.ja || Object.values(values)[0] || null;
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

function decodeHtml(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function htmlMatch(html: string, pattern: RegExp) {
  return decodeHtml(html.match(pattern)?.[1] || "") || null;
}

function xmlValues(xml: string, tag: string) {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "g"))].map((match) => decodeHtml(match[1])).filter(Boolean);
}

async function shueishaCandidates(query: string) {
  const isbn = cleanIsbn(query);
  if (!/^\d{9}[\dX]$/.test(isbn) && !/^97[89]\d{10}$/.test(isbn)) throw new Error("Shueisha Direct needs a Japanese ISBN-10 or ISBN-13, not a title search.");
  const isbn13 = isbn.length === 10 ? isbn13From10(isbn) : isbn;
  if (!isbn13) throw new Error("That ISBN could not be read.");
  const sourceRecordUrl = `https://books.shueisha.co.jp/items/contents.html?isbn=${isbn13.slice(0, 3)}-${isbn13.slice(3, 4)}-${isbn13.slice(4, 6)}-${isbn13.slice(6, 12)}-${isbn13.slice(12)}`;
  const response = await fetch(sourceRecordUrl, { headers: { "User-Agent": "RAR-Index catalogue importer" }, next: { revalidate: 0 } });
  if (!response.ok) throw new Error("Shueisha did not return a usable record.");
  const html = await response.text();
  const sourceIsbn = cleanIsbn(htmlMatch(html, /ISBN[：:]\s*([0-9Xx-]+)/) || "");
  if (!sourceIsbn || (sourceIsbn !== isbn && isbn13From10(sourceIsbn) !== isbn13 && sourceIsbn !== isbn13)) return [];
  const release = html.match(/(\d{4})年(\d{1,2})月(\d{1,2})日発売/);
  const title = htmlMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || htmlMatch(html, /<title[^>]*>([\s\S]*?)<\//i)?.split(/[／|]/)[0]?.trim();
  if (!title) return [];
  return [{
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

async function ndlSearchCandidates(query: string) {
  const isbn = cleanIsbn(query);
  const cql = /^\d{9}[\dX]$/.test(isbn) || /^97[89]\d{10}$/.test(isbn) ? `isbn=\"${isbn}\"` : `title=\"${query.replace(/[\"]/g, "")}\"`;
  const sourceRecordUrl = `https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&maximumRecords=10&query=${encodeURIComponent(cql)}`;
  const response = await fetch(sourceRecordUrl, { headers: { "User-Agent": "RAR-Index catalogue importer" }, next: { revalidate: 0 } });
  if (!response.ok) throw new Error("National Diet Library Search did not return a usable response.");
  const xml = await response.text();
  return [...xml.matchAll(/<recordData>([\s\S]*?)<\/recordData>/g)].flatMap((match, index) => {
    const record = match[1];
    const title = xmlValues(record, "dc:title")[0];
    const candidateIsbn = xmlValues(record, "dc:identifier").map(cleanIsbn).find((value) => /^97[89]\d{10}$/.test(value)) || null;
    const recordId = xmlValues(record, "rdfs:seeAlso")[0]?.match(/R\d+-[^<\s]+/)?.[0] || `result-${index + 1}`;
    if (!title) return [];
    return [{
      external_id: recordId,
      source_record_url: recordId.startsWith("R") ? `https://ndlsearch.ndl.go.jp/books/${recordId}` : sourceRecordUrl,
      raw_payload: { importer: "ndl_search", record_xml: record },
      candidate_kind: "edition_candidate",
      candidate_title: title,
      candidate_author: xmlValues(record, "dc:creator")[0] || null,
      candidate_publisher: xmlValues(record, "dc:publisher")[0] || null,
      candidate_language: languageName(xmlValues(record, "dc:language")[0]),
      candidate_isbn_13: candidateIsbn,
      candidate_release_date: (xmlValues(record, "dc:date")[0] || "").match(/^\d{4}(?:-\d{2}-\d{2})?/)?.[0] || null,
    }];
  });
}

async function openLibraryCandidates(query: string) {
  const fields = [
    "key", "title", "author_name", "publisher", "language", "first_publish_year", "isbn", "cover_i",
    "editions", "editions.key", "editions.title", "editions.publisher", "editions.isbn", "editions.publish_date", "editions.language", "editions.cover_i",
  ].join(",");
  const response = await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&limit=10`, {
    headers: { "User-Agent": "RAR-Index catalogue importer" },
    next: { revalidate: 0 },
  });
  if (!response.ok) throw new Error("Open Library did not return a usable response.");
  const payload = await response.json() as { docs?: Array<Record<string, unknown>> };

  return (payload.docs ?? []).flatMap((record) => {
    const edition = (record.editions as { docs?: Array<Record<string, unknown>> } | undefined)?.docs?.[0];
    const externalId = String(edition?.key || record.key || "").replace("/books/", "").replace("/works/", "");
    const title = String(edition?.title || record.title || "").trim();
    if (!externalId || !title) return [];

    const languages = (edition?.language || record.language) as string[] | undefined;
    const isbn = (edition?.isbn || record.isbn) as string[] | undefined;
    const publishDate = String(edition?.publish_date || record.first_publish_year || "");
    const year = publishDate.match(/^\d{4}/)?.[0];
    const coverId = edition?.cover_i || record.cover_i;

    return [{
      external_id: externalId,
      source_record_url: `https://openlibrary.org/books/${externalId}`,
      raw_payload: record,
      candidate_kind: "edition_candidate",
      candidate_title: title,
      candidate_author: Array.isArray(record.author_name) ? String(record.author_name[0] || "") || null : null,
      candidate_publisher: Array.isArray(edition?.publisher) ? String((edition.publisher as string[])[0] || "") || null : Array.isArray(record.publisher) ? String((record.publisher as string[])[0] || "") || null : null,
      candidate_language: languageName(languages?.[0]),
      candidate_isbn_13: isbn?.find((value) => /^97[89]\d{10}$/.test(value)) || null,
      candidate_release_date: year ? `${year}-01-01` : null,
      candidate_cover_image_url: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : null,
    }];
  });
}

async function mangaDexCandidates(query: string) {
  const parameters = new URLSearchParams({ title: query, limit: "10" });
  parameters.append("includes[]", "author");
  const response = await fetch(`https://api.mangadex.org/manga?${parameters.toString()}`, {
    headers: { "User-Agent": "RAR-Index catalogue importer" },
    next: { revalidate: 0 },
  });
  if (!response.ok) throw new Error("MangaDex did not return a usable response.");
  const payload = await response.json() as { data?: Array<{ id: string; attributes?: Record<string, unknown>; relationships?: Array<{ type?: string; attributes?: { name?: string } }> }> };

  return (payload.data ?? []).flatMap((record) => {
    const attributes = record.attributes ?? {};
    const title = firstTitle(attributes.title as Record<string, string> | undefined);
    if (!record.id || !title) return [];
    const author = record.relationships?.find((relationship) => relationship.type === "author")?.attributes?.name || null;

    return [{
      external_id: record.id,
      source_record_url: `https://mangadex.org/title/${record.id}`,
      raw_payload: record,
      // MangaDex identifies a manga work/series, not a physical printing. It must not auto-create an edition.
      candidate_kind: "series_reference",
      candidate_title: title,
      candidate_author: author,
      candidate_language: languageName(typeof attributes.originalLanguage === "string" ? attributes.originalLanguage : undefined),
      candidate_series: title,
      candidate_volume_number: typeof attributes.lastVolume === "string" ? attributes.lastVolume : null,
    }];
  });
}

export async function POST(request: Request) {
  if (!isStaffRequest(request)) return Response.json({ error: "Staff credentials are required." }, { status: 401 });

  let payload: { source?: unknown; query?: unknown; dryRun?: unknown; selectedExternalIds?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a catalogue source and search term." }, { status: 400 });
  }

  const source = payload.source;
  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  if ((source !== "open_library" && source !== "mangadex" && source !== "shueisha" && source !== "ndl_search") || query.length < 2 || query.length > 120) {
    return Response.json({ error: "Choose a catalogue source and enter a search of 2–120 characters." }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const sourceName = source === "open_library" ? "Open Library" : source === "mangadex" ? "MangaDex" : source === "shueisha" ? "Shueisha Direct" : "National Diet Library Search";
    const { data: sourceRecord, error: sourceError } = await admin.from("sources").select("id").eq("name", sourceName).maybeSingle();
    if (sourceError || !sourceRecord) return Response.json({ error: `${sourceName} is not configured as an RAR source.` }, { status: 500 });

    const candidates = source === "open_library" ? await openLibraryCandidates(query) : source === "mangadex" ? await mangaDexCandidates(query) : source === "shueisha" ? await shueishaCandidates(query) : await ndlSearchCandidates(query);
    if (!candidates.length) return Response.json({ imported: 0, candidates: [], message: "No usable catalogue candidates were returned." });
    if (payload.dryRun === true) return Response.json({ candidates, message: `Review ${candidates.length} source result${candidates.length === 1 ? "" : "s"}; select only the exact record${candidates.length === 1 ? "" : "s"} to queue.` });

    const selectedExternalIds = Array.isArray(payload.selectedExternalIds) ? payload.selectedExternalIds.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean) : [];
    if (!selectedExternalIds.length) return Response.json({ error: "Select at least one exact source record before queuing." }, { status: 400 });
    const selected = candidates.filter((candidate) => selectedExternalIds.includes(candidate.external_id));
    if (!selected.length) return Response.json({ error: "The selected source records are no longer in this search result. Search again." }, { status: 400 });

    const rows = selected.map((candidate) => ({ ...candidate, source_id: sourceRecord.id }));
    const { error: writeError } = await admin.from("catalogue_import_queue").upsert(rows, {
      onConflict: "source_id,external_id",
      ignoreDuplicates: true,
    });
    if (writeError) return Response.json({ error: "Catalogue candidates could not be queued." }, { status: 500 });

    return Response.json({ imported: rows.length, message: `${rows.length} candidate${rows.length === 1 ? "" : "s"} queued for human verification.` });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The catalogue source is unavailable right now. Please try again later." }, { status: 502 });
  }
}
