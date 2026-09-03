import { discoverCoverCandidates } from "@/lib/coverDiscovery";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import { compareCoverResearchPriority } from "@/lib/coveragePriority";

const MAX_BATCH_SIZE = 20;

type QueueEdition = {
  edition_id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  publisher: string | null;
  isbn_13: string | null;
  verified_sale_count: number;
};

function requestedLimit(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(MAX_BATCH_SIZE, Math.max(1, Math.floor(parsed))) : MAX_BATCH_SIZE;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await work(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });

  let payload: { limit?: unknown } = {};
  try {
    payload = await request.json();
  } catch {
    // An empty body means the standard 20-edition batch.
  }

  const limit = requestedLimit(payload.limit);
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("cover_review_queue")
    .select("edition_id,title,series,volume_number,language,publisher,isbn_13,verified_sale_count")
    .not("isbn_13", "is", null)
    .order("verified_sale_count", { ascending: false })
    .order("series", { ascending: true })
    .limit(500);

  if (error) return Response.json({ error: error.message || "The cover queue could not be loaded." }, { status: 500 });

  const queue = (data ?? []) as QueueEdition[];
  const queueIds = queue.map((edition) => edition.edition_id);
  const { data: scanData, error: scanError } = queueIds.length
    ? await admin
      .from("cover_candidate_scans")
      .select("edition_id,scanned_at")
      .in("edition_id", queueIds)
      .order("scanned_at", { ascending: false })
    : { data: [], error: null };
  if (scanError) return Response.json({ error: scanError.message || "Previous cover checks could not be loaded." }, { status: 500 });

  const lastScan = new Map<string, string>();
  for (const scan of scanData ?? []) if (!lastScan.has(scan.edition_id)) lastScan.set(scan.edition_id, scan.scanned_at);
  const editions = [...queue]
    .sort((left, right) => compareCoverResearchPriority(
      { series: left.series, verified_sale_count: left.verified_sale_count, lastScan: lastScan.get(left.edition_id) ?? null },
      { series: right.series, verified_sale_count: right.verified_sale_count, lastScan: lastScan.get(right.edition_id) ?? null },
    ))
    .slice(0, limit);
  const discovered = await mapWithConcurrency(editions, 4, async (edition) => {
    const result = await discoverCoverCandidates({
      title: edition.title,
      series: edition.series,
      volumeNumber: edition.volume_number,
      language: edition.language,
      publisher: edition.publisher,
      isbn13: edition.isbn_13,
    });
    return { edition, ...result };
  });

  const rows = discovered.flatMap(({ edition, candidates }) => candidates.map((candidate) => ({
    edition_id: edition.edition_id,
    source_name: candidate.sourceName,
    external_id: candidate.externalId,
    cover_image_url: candidate.coverImageUrl,
    source_record_url: candidate.sourceRecordUrl,
    candidate_title: candidate.candidateTitle,
    candidate_publisher: candidate.candidatePublisher,
    candidate_language: candidate.candidateLanguage,
    candidate_isbn_13: candidate.candidateIsbn13,
    match_score: candidate.matchScore,
    match_confidence: candidate.matchConfidence,
    match_reasons: candidate.matchReasons,
    raw_payload: candidate.rawPayload,
  })));

  if (discovered.length) {
    const { error: scanInsertError } = await admin.from("cover_candidate_scans").insert(discovered.map(({ edition, candidates, errors }) => ({
      edition_id: edition.edition_id,
      candidates_found: candidates.length,
      source_warnings: errors,
    })));
    if (scanInsertError) return Response.json({ error: scanInsertError.message || "The cover scan audit could not be saved." }, { status: 500 });
  }

  let queued = 0;
  if (rows.length) {
    const { data: inserted, error: insertError } = await admin
      .from("cover_candidates")
      .upsert(rows, { onConflict: "edition_id,source_name,external_id", ignoreDuplicates: true })
      .select("id");
    if (insertError) return Response.json({ error: insertError.message || "Cover candidates could not be queued." }, { status: 500 });
    queued = inserted?.length ?? 0;
  }

  return Response.json({
    ok: true,
    editionsScanned: editions.length,
    candidatesFound: rows.length,
    candidatesQueued: queued,
    sourceWarnings: discovered.flatMap(({ edition, errors }) => errors.map((message) => `${edition.title ?? edition.edition_id}: ${message}`)),
  });
}
