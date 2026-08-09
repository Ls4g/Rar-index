import type { SupabaseClient } from "@supabase/supabase-js";
import type { DisplayCurrency, FxRate } from "@/lib/fx";
import {
  buildSnapshotPayload,
  computeEditionMetrics,
  computePortfolioSummary,
  familyIdsFor,
  groupMetricsByEdition,
  resolvePublicationFamily,
  type SnapshotPayload,
  type ValuationHolding,
  type ValuationSale,
} from "@/lib/portfolioValuation";

export const SNAPSHOT_TRIGGER_REASONS = [
  "holding_added", "holding_updated", "holding_removed",
  "evidence_changed", "daily_cron",
] as const;
export type SnapshotTriggerReason = (typeof SNAPSHOT_TRIGGER_REASONS)[number];

// No per-user display-currency preference exists anywhere in the schema
// (checked: auth.users, collector_profiles) -- every automatic trigger
// (holding changes, evidence changes, the daily cron) records in this one
// fixed currency, matching the site's other base-currency defaults. A user
// can still VIEW their history converted into any currency the site
// supports; that conversion already happens for display, never for what
// gets stored.
export const DEFAULT_SNAPSHOT_CURRENCY: DisplayCurrency = "GBP";

function sortedEntries(record: Record<string, number>) {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
}

// Two snapshots "mean the same thing" only when every figure in them
// matches exactly -- including which currencies got excluded and for how
// much. Timestamps and ids are deliberately not part of the comparison.
function payloadsEqual(a: SnapshotPayload, existing: Record<string, unknown>) {
  return (
    a.total_paid === existing.total_paid &&
    a.total_evidence_value === existing.total_evidence_value &&
    a.gain_loss_amount === existing.gain_loss_amount &&
    a.gain_loss_percent === existing.gain_loss_percent &&
    a.holdings_total_count === existing.holdings_total_count &&
    a.holdings_valued_count === existing.holdings_valued_count &&
    a.holdings_unvalued_count === existing.holdings_unvalued_count &&
    JSON.stringify(sortedEntries(a.paid_excluded_totals)) === JSON.stringify(sortedEntries((existing.paid_excluded_totals as Record<string, number>) ?? {})) &&
    JSON.stringify(sortedEntries(a.evidence_excluded_totals)) === JSON.stringify(sortedEntries((existing.evidence_excluded_totals as Record<string, number>) ?? {}))
  );
}

async function computeSnapshotPayload(admin: SupabaseClient, userId: string, displayCurrency: DisplayCurrency): Promise<SnapshotPayload> {
  const { data: holdingsData, error: holdingsError } = await admin
    .from("portfolio_holdings")
    .select("id,edition_id,quantity,purchase_price,purchase_currency,purchase_date,edition:manga_editions(id,printing_of_edition_id)")
    .eq("user_id", userId);
  if (holdingsError) throw new Error(`Could not load holdings: ${holdingsError.message}`);

  const holdings = (holdingsData ?? []) as unknown as ValuationHolding[];
  const today = new Date().toISOString().slice(0, 10);
  if (!holdings.length) {
    const summary = computePortfolioSummary([], new Map(), [], displayCurrency, today);
    return buildSnapshotPayload(0, summary, displayCurrency);
  }

  const publicationIds = [...new Set(holdings.map((holding) => holding.edition?.printing_of_edition_id ?? holding.edition_id))];
  const { data: childrenData } = await admin
    .from("manga_editions")
    .select("id,printing_of_edition_id")
    .in("printing_of_edition_id", publicationIds);
  const children = (childrenData ?? []) as Array<{ id: string; printing_of_edition_id: string | null }>;

  const { publicationByMember } = resolvePublicationFamily(holdings, children);
  const familyIds = familyIdsFor(holdings, publicationIds, children);

  const { data: salesData } = familyIds.length
    ? await admin
      .from("price_observations")
      .select("edition_id,sale_price,currency,sold_date,print_classification")
      .in("edition_id", familyIds)
      .eq("sale_status", "confirmed")
      .eq("match_status", "verified_match")
    : { data: [] };
  const sales = (salesData ?? []) as ValuationSale[];

  const { metrics } = computeEditionMetrics(holdings, sales, publicationByMember);
  const metricsByEdition = groupMetricsByEdition(metrics);

  const rateCurrencies = [...new Set([
    "GBP", "USD", "EUR",
    ...holdings.flatMap((holding) => holding.purchase_currency ? [holding.purchase_currency] : []),
    ...metrics.map((metric) => metric.currency),
  ])];
  const { data: fxRatesData } = await admin
    .from("exchange_rates")
    .select("rate_date, currency, rate_per_eur, source_name, source_url")
    .in("currency", rateCurrencies)
    .order("rate_date", { ascending: true })
    .limit(2000);
  const rates = (fxRatesData ?? []) as FxRate[];

  const summary = computePortfolioSummary(holdings, metricsByEdition, rates, displayCurrency, today);
  return buildSnapshotPayload(holdings.length, summary, displayCurrency);
}

// Server-side snapshot creation. Deliberately reuses the exact same pure
// functions the live client dashboard uses (lib/portfolioValuation.ts) so a
// stored snapshot can never drift from what the dashboard shows a user in
// the moment it was taken. Runs on the admin (service-role) client, so
// every query below explicitly scopes to the one user_id it was asked to
// snapshot -- there is no RLS backstop here the way there is for
// client-issued queries.
//
// Deduplicated against the most recent snapshot for this user+currency: if
// a burst of holding edits or evidence changes computes the exact same
// figures as what's already the latest recorded row, nothing new is
// inserted -- the append-only table stays a real history of *changes*, not
// a row per trigger firing.
export async function createPortfolioSnapshot(
  admin: SupabaseClient,
  userId: string,
  displayCurrency: DisplayCurrency = DEFAULT_SNAPSHOT_CURRENCY,
  reason: SnapshotTriggerReason | null = null,
): Promise<{ snapshot: Record<string, unknown>; created: boolean }> {
  const payload = await computeSnapshotPayload(admin, userId, displayCurrency);

  const { data: latest } = await admin
    .from("portfolio_snapshots")
    .select("*")
    .eq("user_id", userId)
    .eq("display_currency", displayCurrency)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest && payloadsEqual(payload, latest)) {
    return { snapshot: latest, created: false };
  }

  const { data, error } = await admin
    .from("portfolio_snapshots")
    .insert({ user_id: userId, ...payload, trigger_reason: reason })
    .select()
    .single();
  if (error) throw new Error(`Could not store snapshot: ${error.message}`);
  return { snapshot: data, created: true };
}

// Resolves every user who holds ANY member of the given edition's
// publication family (the edition itself, its publication if it's a
// print-run child, and every sibling print-run) -- reuses the same family
// grouping lib/portfolioValuation.ts already applies to a single user's
// holdings, just run in the other direction (from one edition out to every
// affected holder) since evidence review happens per-edition, not per-user.
export async function resolveHoldersOfEdition(admin: SupabaseClient, editionId: string): Promise<string[]> {
  const { data: editionRow } = await admin
    .from("manga_editions")
    .select("id,printing_of_edition_id")
    .eq("id", editionId)
    .maybeSingle();
  if (!editionRow) return [];

  const publicationId = editionRow.printing_of_edition_id ?? editionRow.id;
  const { data: siblingsData } = await admin
    .from("manga_editions")
    .select("id")
    .eq("printing_of_edition_id", publicationId);
  const familyIds = [...new Set([publicationId, editionId, ...(siblingsData ?? []).map((row) => row.id as string)])];

  const { data: holdingsData } = await admin
    .from("portfolio_holdings")
    .select("user_id")
    .in("edition_id", familyIds);
  return [...new Set((holdingsData ?? []).map((row) => row.user_id as string))];
}

export type SnapshotHoldersResult = { affectedUsers: number; created: number; skipped: number; failed: number };

// Called after a price_observations mutation that can change what counts
// as verified evidence for an edition (a review decision or a print
// classification decision -- see the call sites in app/api/review and
// app/api/print-classification). Never lets one user's snapshot failure
// block another's, and never fails the caller's own staff-facing response.
export async function snapshotHoldersOfEdition(admin: SupabaseClient, editionId: string, reason: SnapshotTriggerReason = "evidence_changed"): Promise<SnapshotHoldersResult> {
  const userIds = await resolveHoldersOfEdition(admin, editionId);
  const results = await Promise.all(userIds.map(async (userId) => {
    try {
      const { created } = await createPortfolioSnapshot(admin, userId, DEFAULT_SNAPSHOT_CURRENCY, reason);
      return created ? "created" : "skipped";
    } catch {
      return "failed";
    }
  }));

  return {
    affectedUsers: userIds.length,
    created: results.filter((result) => result === "created").length,
    skipped: results.filter((result) => result === "skipped").length,
    failed: results.filter((result) => result === "failed").length,
  };
}
