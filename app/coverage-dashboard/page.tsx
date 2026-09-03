import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { comparisonGroup } from "@/lib/fx";
import CoverageDashboardClient, { type CoverageRow } from "@/components/CoverageDashboardClient";
import StaffNav from "@/components/StaffNav";

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
  match_status: string | null;
  sale_status: string | null;
};

type PrintRunChild = {
  id: string;
  printing_of_edition_id: string | null;
};

type ActiveProfile = {
  id: string;
  edition_id: string;
};

type ScoutLead = {
  profile_id: string;
  review_status: string | null;
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

  // Public edition pages are publication pages. A print-run child redirects
  // there and contributes its evidence to the parent, so this staff screen
  // must use the same family scope. Otherwise a parent can misleadingly
  // appear to have zero sales while its verified first-print child has five.
  const rows = ((readinessData ?? []) as unknown as ReadinessRow[])
    .filter((row) => !row.printing_of_edition_id);
  const publicationIds = rows.map((row) => row.edition_id);

  const { data: printRunData } = publicationIds.length
    ? await admin
      .from("manga_editions")
      .select("id,printing_of_edition_id")
      .in("printing_of_edition_id", publicationIds)
      .eq("is_verified", true)
    : { data: [] };
  const printRuns = (printRunData ?? []) as PrintRunChild[];
  const publicationByMember = new Map<string, string>();
  for (const publicationId of publicationIds) publicationByMember.set(publicationId, publicationId);
  for (const printRun of printRuns) {
    if (printRun.printing_of_edition_id) publicationByMember.set(printRun.id, printRun.printing_of_edition_id);
  }
  const familyIds = [...publicationByMember.keys()];

  const [{ data: saleData }, { data: profileData }] = await Promise.all([
    familyIds.length
      ? admin
        .from("price_observations")
        .select("edition_id,grading_company,grade_label,match_status,sale_status")
        .in("edition_id", familyIds)
        .limit(5000)
      : Promise.resolve({ data: [] }),
    familyIds.length
      ? admin
        .from("marketplace_search_profiles")
        .select("id,edition_id")
        .eq("is_active", true)
        .in("edition_id", familyIds)
      : Promise.resolve({ data: [] }),
  ]);

  // Chart readiness needs 3 verified sales in the SAME raw/graded group, not
  // just 3 verified sales overall — this mirrors the exact grouping used by
  // the price chart and collection-profiles workbench.
  const comparableCountByEdition = new Map<string, number>();
  const rawSaleCountByPublication = new Map<string, number>();
  const groupCounts = new Map<string, Map<string, number>>();
  const reviewSaleCountByPublication = new Map<string, number>();
  const verifiedSaleCountByPublication = new Map<string, number>();
  for (const sale of (saleData ?? []) as SaleForGrouping[]) {
    const publicationId = publicationByMember.get(sale.edition_id) ?? sale.edition_id;
    if (sale.match_status === "needs_review") {
      reviewSaleCountByPublication.set(publicationId, (reviewSaleCountByPublication.get(publicationId) ?? 0) + 1);
    }
    if (sale.sale_status !== "confirmed" || sale.match_status !== "verified_match") continue;
    verifiedSaleCountByPublication.set(publicationId, (verifiedSaleCountByPublication.get(publicationId) ?? 0) + 1);
    if (!sale.grading_company && !sale.grade_label) {
      rawSaleCountByPublication.set(publicationId, (rawSaleCountByPublication.get(publicationId) ?? 0) + 1);
    }
    const groups = groupCounts.get(publicationId) ?? new Map<string, number>();
    const { key } = comparisonGroup({ sold_date: null, sale_price: 0, currency: "", grading_company: sale.grading_company, grade_label: sale.grade_label });
    groups.set(key, (groups.get(key) ?? 0) + 1);
    groupCounts.set(publicationId, groups);
  }
  for (const [editionId, groups] of groupCounts) {
    comparableCountByEdition.set(editionId, Math.max(...groups.values()));
  }

  const profileByPublication = new Map<string, string>();
  const activeProfiles = (profileData ?? []) as ActiveProfile[];
  for (const profile of activeProfiles) {
    const publicationId = publicationByMember.get(profile.edition_id) ?? profile.edition_id;
    if (!profileByPublication.has(publicationId)) profileByPublication.set(publicationId, profile.id);
  }

  const profileIds = activeProfiles.map((profile) => profile.id);
  const { data: leadData } = profileIds.length
    ? await admin
      .from("scout_listing_leads")
      .select("profile_id,review_status")
      .in("profile_id", profileIds)
      .eq("review_status", "new")
      .limit(5000)
    : { data: [] };
  const publicationByProfile = new Map(activeProfiles.map((profile) => [profile.id, publicationByMember.get(profile.edition_id) ?? profile.edition_id]));
  const pendingLeadCountByPublication = new Map<string, number>();
  for (const lead of (leadData ?? []) as ScoutLead[]) {
    const publicationId = publicationByProfile.get(lead.profile_id);
    if (publicationId && lead.review_status === "new") {
      pendingLeadCountByPublication.set(publicationId, (pendingLeadCountByPublication.get(publicationId) ?? 0) + 1);
    }
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
    verifiedSaleCount: verifiedSaleCountByPublication.get(row.edition_id) ?? 0,
    reviewSaleCount: reviewSaleCountByPublication.get(row.edition_id) ?? 0,
    comparableSaleCount: comparableCountByEdition.get(row.edition_id) ?? 0,
    rawSaleCount: rawSaleCountByPublication.get(row.edition_id) ?? 0,
    profileId: profileByPublication.get(row.edition_id) ?? null,
    pendingLeadCount: pendingLeadCountByPublication.get(row.edition_id) ?? 0,
  }));

  return (
    <main className="review-page catalogue-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/data-readiness">Data readiness -&gt;</Link>
        <Link className="header-note" href="/cover-review">Cover review -&gt;</Link>
        <Link className="header-note" href="/scout">RAR Scout -&gt;</Link>
        <Link className="header-note" href="/review">Review queue -&gt;</Link>
        <Link className="header-note" href="/collection-profiles">Collection profiles -&gt;</Link>
        <Link className="header-note" href="/price-import">Price import -&gt;</Link>
        <StaffNav current="/coverage-dashboard" />
      </header>
      <section className="review-hero catalogue-hero">
        <div>
          <p className="eyebrow">Internal data operations</p>
          <h1>Priority coverage dashboard</h1>
          <p>Ranks the public catalogue by what is actually missing — verified sales and verified covers — so staff work always removes a real gap instead of adding activity for its own sake. Nothing here treats a live listing as a sale or an unreviewed lead as evidence.</p>
        </div>
        <div className="queue-total"><strong>{coverageRows.length}</strong><span>catalogue-ready publications tracked</span></div>
      </section>
      <section className="catalogue-content">
        <CoverageDashboardClient rows={coverageRows} />
      </section>
    </main>
  );
}
