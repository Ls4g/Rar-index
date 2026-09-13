import Link from "next/link";
import ListingOutcomesPanel, { type OutcomeCapability, type OutcomeRow } from "@/components/ListingOutcomesPanel";
import StaffNav from "@/components/StaffNav";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { readWatchToSaleMetrics } from "@/lib/watchToSale";
import { probeOutcomeProviders } from "@/lib/listingOutcomeProviders";
import {
  OUTCOME_PAGE_SIZE,
  browseOutcomes,
  normalisePage,
  normaliseQueue,
  normaliseSort,
  normaliseView,
  type BrowsableOutcome,
} from "@/lib/outcomeBrowsing";

export const dynamic = "force-dynamic";

type EditionLabelParts = { title: string | null; series: string | null; volume_number: string | null; language: string | null } | null;

type OutcomeRecord = {
  id: string; external_id: string; marketplace: string; status: string; edition_id: string; profile_id: string | null;
  listing_title: string; image_url: string | null; source_listing_url: string;
  asking_price: number | null; currency: string | null;
  sold_price: number | null; sold_currency: string | null; sold_at: string | null;
  buying_format: string | null; bid_count: number | null; scheduled_end_at: string | null;
  first_seen_at: string; last_seen_at: string;
  outcome_reason: string | null; outcome_provider: string | null;
  match_assessment: { score?: number; confidence?: string; reasons?: string[]; conflicts?: string[] } | null;
  check_attempts: number; next_check_at: string | null; last_error: string | null;
  reviewed_by: string | null; resulting_observation_id: string | null;
  edition: EditionLabelParts;
};

// Only what deciding an outcome's tab, queue, order and search match needs.
// Loading the full row for all 1800+ outcomes would be 2.6MB on the wire; the
// full detail is loaded for one page instead.
type BrowseRecord = {
  id: string; external_id: string; marketplace: string; status: string;
  listing_title: string; asking_price: number | null; currency: string | null;
  sold_price: number | null; sold_currency: string | null; sold_at: string | null;
  buying_format: string | null; match_assessment: { score?: number; conflicts?: string[] } | null;
  last_seen_at: string; outcome_reason: string | null; check_attempts: number; reviewed_by: string | null;
  edition: EditionLabelParts;
};

const BROWSE_SELECT = "id,external_id,marketplace,status,listing_title,asking_price,currency,sold_price,sold_currency,sold_at,buying_format,match_assessment,last_seen_at,outcome_reason,check_attempts,reviewed_by,edition:manga_editions(title,series,volume_number,language)";
const DETAIL_SELECT = "id,external_id,marketplace,status,edition_id,profile_id,listing_title,image_url,source_listing_url,asking_price,currency,sold_price,sold_currency,sold_at,buying_format,bid_count,scheduled_end_at,first_seen_at,last_seen_at,outcome_reason,outcome_provider,match_assessment,check_attempts,next_check_at,last_error,reviewed_by,resulting_observation_id,edition:manga_editions(title,series,volume_number,language)";

function editionLabel(edition: EditionLabelParts) {
  return [
    edition?.series || edition?.title,
    edition?.volume_number ? `Vol. ${edition.volume_number}` : null,
    edition?.language,
  ].filter(Boolean).join(" · ") || "Unknown edition";
}

/**
 * PostgREST returns at most `db-max-rows` per response (1000 on Supabase), so
 * a single select cannot be trusted to have returned everything. Read in
 * ranges until a short page comes back. Ordered by id so the sequence handed
 * to the browser is the same on every request.
 */
async function fetchAllBrowseRecords(admin: ReturnType<typeof getSupabaseAdmin>) {
  const rows: BrowseRecord[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("listing_outcomes")
      .select(BROWSE_SELECT)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return { rows, error };
    const batch = (data ?? []) as unknown as BrowseRecord[];
    rows.push(...batch);
    if (batch.length < pageSize) return { rows, error: null };
  }
}

function toBrowsable(record: BrowseRecord): BrowsableOutcome {
  return {
    id: record.id,
    externalId: record.external_id,
    editionLabel: editionLabel(record.edition),
    status: record.status,
    listingTitle: record.listing_title,
    askingPrice: record.asking_price,
    currency: record.currency,
    soldPrice: record.sold_price,
    soldCurrency: record.sold_currency,
    soldAt: record.sold_at,
    buyingFormat: record.buying_format,
    matchScore: record.match_assessment?.score ?? null,
    matchConflicts: record.match_assessment?.conflicts ?? [],
    lastSeenAt: record.last_seen_at,
    outcomeReason: record.outcome_reason,
    reviewedBy: record.reviewed_by,
    checkAttempts: record.check_attempts,
  };
}

export default async function ListingOutcomesPage({ searchParams }: {
  searchParams: Promise<{ outcome?: string | string[]; view?: string | string[]; queue?: string | string[]; page?: string | string[]; q?: string | string[]; sort?: string | string[] }>;
}) {
  const parameters = await searchParams;
  const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const focusOutcomeId = one(parameters.outcome) ?? null;
  const admin = getSupabaseAdmin();

  const { rows: browseRecords, error: browseError } = await fetchAllBrowseRecords(admin);

  // Classify and count every outcome, then serve only the page asked for. The
  // counts therefore describe the whole table rather than the rows that
  // happened to fit inside a query limit.
  const browse = browseOutcomes({
    rows: browseRecords.map(toBrowsable),
    view: normaliseView(one(parameters.view)),
    queue: normaliseQueue(one(parameters.queue)),
    sort: normaliseSort(one(parameters.sort)),
    search: one(parameters.q) ?? "",
    page: normalisePage(one(parameters.page)),
    pageSize: OUTCOME_PAGE_SIZE,
    focusId: focusOutcomeId,
  });

  const pageIds = browse.pageRows.map((row) => row.id);
  const [{ data: detailData }, { data: checkData }] = await Promise.all([
    pageIds.length
      ? admin.from("listing_outcomes").select(DETAIL_SELECT).in("id", pageIds)
      : Promise.resolve({ data: [] }),
    pageIds.length
      ? admin.from("listing_outcome_checks")
        .select("outcome_id,provider,attempt_number,http_status,listing_state,detail,checked_at")
        .in("outcome_id", pageIds)
        .order("checked_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const checksByOutcome = new Map<string, OutcomeRow["checks"]>();
  for (const check of (checkData ?? []) as Array<Record<string, unknown>>) {
    const list = checksByOutcome.get(check.outcome_id as string) ?? [];
    list.push({
      provider: check.provider as string,
      attempt: check.attempt_number as number,
      httpStatus: (check.http_status as number | null) ?? null,
      state: (check.listing_state as string | null) ?? null,
      detail: (check.detail as string | null) ?? null,
      checkedAt: check.checked_at as string,
    });
    checksByOutcome.set(check.outcome_id as string, list);
  }

  // Keep the order the browser decided; `in` does not preserve it.
  const detailById = new Map(((detailData ?? []) as unknown as OutcomeRecord[]).map((record) => [record.id, record]));
  const rows: OutcomeRow[] = pageIds
    .map((id) => detailById.get(id))
    .filter((record): record is OutcomeRecord => Boolean(record))
    .map((record) => ({
      id: record.id,
      externalId: record.external_id,
      status: record.status,
      editionId: record.edition_id,
      profileId: record.profile_id,
      editionLabel: editionLabel(record.edition),
      listingTitle: record.listing_title,
      imageUrl: record.image_url,
      sourceListingUrl: record.source_listing_url,
      askingPrice: record.asking_price,
      currency: record.currency,
      soldPrice: record.sold_price,
      soldCurrency: record.sold_currency,
      soldAt: record.sold_at,
      buyingFormat: record.buying_format,
      bidCount: record.bid_count,
      scheduledEndAt: record.scheduled_end_at,
      firstSeenAt: record.first_seen_at,
      lastSeenAt: record.last_seen_at,
      outcomeReason: record.outcome_reason,
      outcomeProvider: record.outcome_provider,
      matchScore: record.match_assessment?.score ?? null,
      matchConfidence: record.match_assessment?.confidence ?? null,
      matchReasons: record.match_assessment?.reasons ?? [],
      matchConflicts: record.match_assessment?.conflicts ?? [],
      checkAttempts: record.check_attempts,
      nextCheckAt: record.next_check_at,
      lastError: record.last_error,
      reviewedBy: record.reviewed_by,
      observationId: record.resulting_observation_id,
      checks: checksByOutcome.get(record.id) ?? [],
    }));

  // Prefer a listing eBay still reports as active: a successful GetItem read
  // proves much more than merely finding a token in the environment.
  const capabilitySample = browseRecords.find((record) => record.status === "active") ?? browseRecords[0] ?? null;

  const [counts, capabilities] = await Promise.all([
    readWatchToSaleMetrics(admin),
    probeOutcomeProviders(capabilitySample ? { itemId: capabilitySample.external_id, marketplace: capabilitySample.marketplace } : undefined)
      .catch((): OutcomeCapability[] => [{ provider: "eBay", available: false, canConfirmSales: false, detail: "The capability probe could not reach eBay." }]),
  ]);

  return (
    <main className="review-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/scout">Scout →</Link>
        <Link className="header-note" href="/review">Review queue →</Link>
        <StaffNav current="/listing-outcomes" />
      </header>
      <section className="catalogue-content">
        {browseError ? <p className="outcome-message" role="alert">Some listings could not be loaded, so the counts below are incomplete. Reload to try again.</p> : null}
        <ListingOutcomesPanel
          capabilities={capabilities}
          counts={counts}
          focusOutcomeId={focusOutcomeId}
          focusMissing={browse.focusMissing}
          focusRedirected={browse.focusRedirected}
          page={browse.page}
          pageCount={browse.pageCount}
          pageSize={browse.pageSize}
          firstIndex={browse.firstIndex}
          lastIndex={browse.lastIndex}
          total={browse.total}
          queue={browse.queue}
          queueCounts={browse.queueCounts}
          renderedAt={new Date().toISOString()}
          rows={rows}
          search={browse.search}
          sort={browse.sort}
          view={browse.view}
          viewCounts={browse.viewCounts}
        />
      </section>
    </main>
  );
}
