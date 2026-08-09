import type { SupabaseClient } from "@supabase/supabase-js";
import type { DisplayCurrency, FxRate } from "@/lib/fx";
import {
  buildSnapshotPayload,
  computeEditionMetrics,
  computePortfolioSummary,
  familyIdsFor,
  groupMetricsByEdition,
  resolvePublicationFamily,
  type ValuationHolding,
  type ValuationSale,
} from "@/lib/portfolioValuation";

// Server-side snapshot creation. Deliberately reuses the exact same pure
// functions the live client dashboard uses (lib/portfolioValuation.ts) so a
// stored snapshot can never drift from what the dashboard shows a user in
// the moment it was taken. Runs on the admin (service-role) client, so
// every query below explicitly scopes to the one user_id it was asked to
// snapshot -- there is no RLS backstop here the way there is for
// client-issued queries.
export async function createPortfolioSnapshot(admin: SupabaseClient, userId: string, displayCurrency: DisplayCurrency = "GBP") {
  const { data: holdingsData, error: holdingsError } = await admin
    .from("portfolio_holdings")
    .select("id,edition_id,quantity,purchase_price,purchase_currency,purchase_date,edition:manga_editions(id,printing_of_edition_id)")
    .eq("user_id", userId);
  if (holdingsError) throw new Error(`Could not load holdings: ${holdingsError.message}`);

  const holdings = (holdingsData ?? []) as unknown as ValuationHolding[];
  if (!holdings.length) {
    const summary = computePortfolioSummary([], new Map(), [], displayCurrency, new Date().toISOString().slice(0, 10));
    const payload = buildSnapshotPayload(0, summary, displayCurrency);
    return insertSnapshot(admin, userId, payload);
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

  const today = new Date().toISOString().slice(0, 10);
  const summary = computePortfolioSummary(holdings, metricsByEdition, rates, displayCurrency, today);
  const payload = buildSnapshotPayload(holdings.length, summary, displayCurrency);
  return insertSnapshot(admin, userId, payload);
}

async function insertSnapshot(admin: SupabaseClient, userId: string, payload: ReturnType<typeof buildSnapshotPayload>) {
  const { data, error } = await admin
    .from("portfolio_snapshots")
    .insert({ user_id: userId, ...payload })
    .select()
    .single();
  if (error) throw new Error(`Could not store snapshot: ${error.message}`);
  return data;
}
