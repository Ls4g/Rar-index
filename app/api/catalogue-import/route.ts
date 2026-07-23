import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type CatalogueSource = "open_library" | "mangadex";

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

  let payload: { source?: unknown; query?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a catalogue source and search term." }, { status: 400 });
  }

  const source = payload.source;
  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  if ((source !== "open_library" && source !== "mangadex") || query.length < 2 || query.length > 120) {
    return Response.json({ error: "Choose Open Library or MangaDex and enter a search of 2–120 characters." }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const sourceName = source === "open_library" ? "Open Library" : "MangaDex";
    const { data: sourceRecord, error: sourceError } = await admin.from("sources").select("id").eq("name", sourceName).maybeSingle();
    if (sourceError || !sourceRecord) return Response.json({ error: `${sourceName} is not configured as an RAR source.` }, { status: 500 });

    const candidates = source === "open_library" ? await openLibraryCandidates(query) : await mangaDexCandidates(query);
    if (!candidates.length) return Response.json({ imported: 0, message: "No usable catalogue candidates were returned." });

    const rows = candidates.map((candidate) => ({ ...candidate, source_id: sourceRecord.id }));
    const { error: writeError } = await admin.from("catalogue_import_queue").upsert(rows, {
      onConflict: "source_id,external_id",
      ignoreDuplicates: true,
    });
    if (writeError) return Response.json({ error: "Catalogue candidates could not be queued." }, { status: 500 });

    return Response.json({ imported: rows.length, message: `${rows.length} candidate${rows.length === 1 ? "" : "s"} queued for human verification.` });
  } catch {
    return Response.json({ error: "The catalogue source is unavailable right now. Please try again later." }, { status: 502 });
  }
}
