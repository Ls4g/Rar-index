import Link from "next/link";
import ListingOutcomesPanel, { type OutcomeCapability, type OutcomeRow } from "@/components/ListingOutcomesPanel";
import StaffNav from "@/components/StaffNav";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { readWatchToSaleMetrics } from "@/lib/watchToSale";
import { probeOutcomeProviders } from "@/lib/listingOutcomeProviders";

export const dynamic = "force-dynamic";

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
  edition: { title: string | null; series: string | null; volume_number: string | null; language: string | null } | null;
};

export default async function ListingOutcomesPage() {
  const admin = getSupabaseAdmin();

  const outcomeSelect = "id,external_id,marketplace,status,edition_id,profile_id,listing_title,image_url,source_listing_url,asking_price,currency,sold_price,sold_currency,sold_at,buying_format,bid_count,scheduled_end_at,first_seen_at,last_seen_at,outcome_reason,outcome_provider,match_assessment,check_attempts,next_check_at,last_error,reviewed_by,resulting_observation_id,edition:manga_editions(title,series,volume_number,language)";

  // Fetch actionable outcomes separately so hundreds of active listings cannot
  // push a sold candidate or unresolved Best Offer beyond the page limit.
  const [attentionResult, activeResult, recentResolvedResult] = await Promise.all([
    admin.from("listing_outcomes")
      .select(outcomeSelect)
      .in("status", ["sold_candidate", "ended_pending_check", "ambiguous", "inaccessible"])
      .is("reviewed_by", null)
      .order("sold_at", { ascending: false, nullsFirst: false })
      .limit(200),
    admin.from("listing_outcomes")
      .select(outcomeSelect)
      .eq("status", "active")
      .order("last_seen_at", { ascending: false })
      .limit(75),
    admin.from("listing_outcomes")
      .select(outcomeSelect)
      .in("status", ["unsold", "review_complete"])
      .order("updated_at", { ascending: false })
      .limit(25),
  ]);

  const records = [
    ...(attentionResult.data ?? []),
    ...(activeResult.data ?? []),
    ...(recentResolvedResult.data ?? []),
  ] as unknown as OutcomeRecord[];
  const priority: Record<string, number> = { sold_candidate: 0, ended_pending_check: 1, ambiguous: 2, active: 3, inaccessible: 4, unsold: 5, review_complete: 6 };
  records.sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));

  const { data: checkData } = records.length
    ? await admin.from("listing_outcome_checks")
      .select("outcome_id,provider,attempt_number,http_status,listing_state,detail,checked_at")
      .in("outcome_id", records.map((record) => record.id))
      .order("checked_at", { ascending: false })
    : { data: [] };
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

  const rows: OutcomeRow[] = records.map((record) => ({
    id: record.id,
    externalId: record.external_id,
    status: record.status,
    editionId: record.edition_id,
    profileId: record.profile_id,
    editionLabel: [record.edition?.series || record.edition?.title, record.edition?.volume_number ? `Vol. ${record.edition.volume_number}` : null, record.edition?.language].filter(Boolean).join(" · ") || "Unknown edition",
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
  const capabilitySample = records.find((record) => record.status === "active") ?? records[0] ?? null;

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
        <ListingOutcomesPanel capabilities={capabilities} counts={counts} rows={rows} />
      </section>
    </main>
  );
}
