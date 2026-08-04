import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { comparisonGroup } from "@/lib/fx";
import CoverageDashboardClient, { type CoverageRow } from "@/components/CoverageDashboardClient";

export const dynamic = "force-dynamic";

type ReadinessRow = {
  edition_id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  isbn_13: string | null;
  publisher: string | null;
  release_date: string | null;
  printing_number: number | null;
  is_verified: boolean;
  verified_sale_count: number;
  review_sale_count: number;
  edition_statement: string | null;
  variant_name: string | null;
  collectible_type: string | null;
  cover_verification_status: string | null;
  printing_of_edition_id: string | null;
  pending_lead_count: number;
};

type SaleForGrouping = {
  edition_id: string;
  grading_company: string | null;
  grade_label: string | null;
};

export default async function CoverageDashboardPage() {
  const admin = getSupabaseAdmin();

  const { data: readinessData } = await admin
    .from("edition_readiness")
    .select("edition_id,title,series,volume_number,language,isbn_13,publisher,release_date,printing_number,is_verified,verified_sale_count,review_sale_count,edition_statement,variant_name,collectible_type,cover_verification_status,printing_of_edition_id,pending_lead_count")
    .eq("is_verified", true)
    .not("isbn_13", "is", null)
    .not("publisher", "is", null)
    .not("release_date", "is", null);

  const rows = (readinessData ?? []) as unknown as ReadinessRow[];
  const editionIds = rows.map((row) => row.edition_id);

  const [{ data: saleData }, { data: profileData }] = await Promise.all([
    editionIds.length
      ? admin
        .from("price_observations")
        .select("edition_id,grading_company,grade_label")
        .in("edition_id", editionIds)
        .eq("sale_status", "confirmed")
        .eq("match_status", "verified_match")
        .limit(5000)
      : Promise.resolve({ data: [] }),
    editionIds.length
      ? admin
        .from("marketplace_search_profiles")
        .select("id,edition_id")
        .eq("is_active", true)
        .in("edition_id", editionIds)
      : Promise.resolve({ data: [] }),
  ]);

  // Chart readiness needs 3 verified sales in the SAME raw/graded group, not
  // just 3 verified sales overall — this mirrors the exact grouping used by
  // the price chart and collection-profiles workbench.
  const comparableCountByEdition = new Map<string, number>();
  const groupCounts = new Map<string, Map<string, number>>();
  for (const sale of (saleData ?? []) as SaleForGrouping[]) {
    const groups = groupCounts.get(sale.edition_id) ?? new Map<string, number>();
    const { key } = comparisonGroup({ sold_date: null, sale_price: 0, currency: "", grading_company: sale.grading_company, grade_label: sale.grade_label });
    groups.set(key, (groups.get(key) ?? 0) + 1);
    groupCounts.set(sale.edition_id, groups);
  }
  for (const [editionId, groups] of groupCounts) {
    comparableCountByEdition.set(editionId, Math.max(...groups.values()));
  }

  const profileByEdition = new Map<string, string>();
  for (const profile of (profileData ?? []) as Array<{ id: string; edition_id: string }>) {
    if (!profileByEdition.has(profile.edition_id)) profileByEdition.set(profile.edition_id, profile.id);
  }

  const coverageRows: CoverageRow[] = rows.map((row) => ({
    editionId: row.edition_id,
    title: row.title,
    series: row.series,
    volumeNumber: row.volume_number,
    language: row.language,
    isbn13: row.isbn_13,
    publisher: row.publisher,
    printingNumber: row.printing_number,
    editionStatement: row.edition_statement,
    variantName: row.variant_name,
    collectibleType: row.collectible_type,
    coverStatus: (row.cover_verification_status ?? "missing") as CoverageRow["coverStatus"],
    printingOfEditionId: row.printing_of_edition_id,
    verifiedSaleCount: row.verified_sale_count,
    reviewSaleCount: row.review_sale_count,
    comparableSaleCount: comparableCountByEdition.get(row.edition_id) ?? 0,
    profileId: profileByEdition.get(row.edition_id) ?? null,
    pendingLeadCount: row.pending_lead_count,
  }));

  return (
    <main className="review-page catalogue-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/data-readiness">Data readiness -&gt;</Link>
        <Link className="header-note" href="/scout">RAR Scout -&gt;</Link>
        <Link className="header-note" href="/review">Review queue -&gt;</Link>
        <Link className="header-note" href="/collection-profiles">Collection profiles -&gt;</Link>
        <Link className="header-note" href="/price-import">Price import -&gt;</Link>
      </header>
      <section className="review-hero catalogue-hero">
        <div>
          <p className="eyebrow">Internal data operations</p>
          <h1>Priority coverage dashboard</h1>
          <p>Ranks the public catalogue by what is actually missing — verified sales and verified covers — so staff work always removes a real gap instead of adding activity for its own sake. Nothing here treats a live listing as a sale or an unreviewed lead as evidence.</p>
        </div>
        <div className="queue-total"><strong>{coverageRows.length}</strong><span>catalogue-ready editions tracked</span></div>
      </section>
      <section className="catalogue-content">
        <CoverageDashboardClient rows={coverageRows} />
      </section>
    </main>
  );
}
