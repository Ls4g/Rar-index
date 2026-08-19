import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { searchNdlCatalogue, searchOpenLibraryCatalogue, searchShueishaCatalogue } from "@/lib/catalogueSources";

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

const publisherRecords = {
  kodansha_japan: { name: "Kodansha Japan", publisher: "Kodansha", language: "Japanese", hosts: ["www.kodansha.co.jp", "kc.kodansha.co.jp"] },
  kodansha_usa: { name: "Kodansha USA", publisher: "Kodansha", language: "English", hosts: ["kodansha.us", "archive.kodansha.us"] },
  viz_media: { name: "VIZ Media", publisher: "VIZ Media", language: "English", hosts: ["www.viz.com", "viz.com"] },
  tokyopop_archive: { name: "TokyoPop Archive (Open Library)", publisher: "TokyoPop", language: "English", hosts: ["openlibrary.org"] },
} as const;

type PublisherRecordSource = keyof typeof publisherRecords;

function titleFromHtml(html: string) {
  return htmlMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || htmlMatch(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
    || htmlMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
}

function isbnFromHtml(html: string) {
  const match = html.match(/ISBN(?:-1[03])?[^0-9Xx]{0,24}((?:97[89][\s-]*)?\d[\d\s-]{8,15}[\dXx])/i);
  const isbn = cleanIsbn(match?.[1] || "");
  return /^97[89]\d{10}$/.test(isbn) ? isbn : isbn13From10(isbn);
}

async function publisherRecordCandidates(query: string, publisherSource: PublisherRecordSource) {
  const source = publisherRecords[publisherSource];
  if (!source) throw new Error("Choose a supported publisher record source.");
  let sourceRecordUrl: URL;
  try { sourceRecordUrl = new URL(query); } catch { throw new Error("Enter a full publisher-record URL."); }
  if (sourceRecordUrl.protocol !== "https:" || !source.hosts.includes(sourceRecordUrl.hostname as never)) throw new Error(`That URL is not an approved ${source.name} record.`);
  const response = await fetch(sourceRecordUrl, { headers: { "User-Agent": "RAR-Index catalogue importer" }, next: { revalidate: 0 } });
  if (!response.ok) throw new Error(`${source.name} did not return a usable record.`);
  const html = await response.text();
  const title = titleFromHtml(html);
  if (!title) return [];
  return [{
    external_id: sourceRecordUrl.toString(),
    source_record_url: sourceRecordUrl.toString(),
    raw_payload: { importer: "publisher_record", publisher_source: publisherSource, source_html: html },
    candidate_kind: "edition_candidate" as const,
    candidate_title: title,
    candidate_publisher: source.publisher,
    candidate_language: source.language,
    candidate_isbn_13: isbnFromHtml(html),
  }];
}

export async function POST(request: Request) {
  if (!isStaffRequest(request)) return Response.json({ error: "Staff credentials are required." }, { status: 401 });

  let payload: { source?: unknown; publisherSource?: unknown; query?: unknown; queries?: unknown; dryRun?: unknown; selectedExternalIds?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a catalogue source and search term." }, { status: 400 });
  }

  const source = payload.source;
  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  const suppliedQueries = Array.isArray(payload.queries)
    ? payload.queries.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    : query ? [query] : [];
  const publisherSource = typeof payload.publisherSource === "string" ? payload.publisherSource as PublisherRecordSource : null;
  // These bibliographic sources accept stable identifiers in batches. Other
  // sources stay one-query-at-a-time to avoid creating a broad, noisy queue.
  const searchQueries = source === "shueisha" || source === "ndl_search" ? [...new Set(suppliedQueries)] : suppliedQueries.slice(0, 1);
  if ((source !== "open_library" && source !== "mangadex" && source !== "shueisha" && source !== "ndl_search" && source !== "publisher_record") || !searchQueries.length || searchQueries.length > 25 || searchQueries.some((value) => value.length < 2 || value.length > 500) || (source === "publisher_record" && (!publisherSource || !publisherRecords[publisherSource]))) {
    return Response.json({ error: "Choose a catalogue source and enter a search of 2–120 characters." }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const sourceName = source === "open_library" ? "Open Library" : source === "mangadex" ? "MangaDex" : source === "shueisha" ? "Shueisha Direct" : source === "ndl_search" ? "National Diet Library Search" : publisherRecords[publisherSource!].name;
    const { data: sourceRecord, error: sourceError } = await admin.from("sources").select("id").eq("name", sourceName).maybeSingle();
    if (sourceError || !sourceRecord) return Response.json({ error: `${sourceName} is not configured as an RAR source.` }, { status: 500 });

    const candidateGroups = await Promise.all(searchQueries.map((searchQuery) => (
      source === "open_library" ? searchOpenLibraryCatalogue(searchQuery)
        : source === "mangadex" ? mangaDexCandidates(searchQuery)
          : source === "shueisha" ? searchShueishaCatalogue(searchQuery)
            : source === "ndl_search" ? searchNdlCatalogue(searchQuery)
              : publisherRecordCandidates(searchQuery, publisherSource!)
    )));
    const candidates = candidateGroups.flat().filter((candidate, index, values) => values.findIndex((value) => value.external_id === candidate.external_id) === index);
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
