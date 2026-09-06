import Link from "next/link";
import BulkApprovedSalesForm from "@/components/BulkApprovedSalesForm";
import QuickSaleForm from "@/components/QuickSaleForm";
import StaffNav from "@/components/StaffNav";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ebayCompletedSearchUrl, prioritiseSoldSearches, soldSearchReason, type SoldSearchCandidate } from "@/lib/soldSearchPriority";

export const dynamic = "force-dynamic";

type AddSalePageProps = { searchParams: Promise<{ editionId?: string | string[] }> };
type SearchProfile = {
  id: string;
  edition_id: string;
  search_query: string;
  edition: { id: string; title: string | null; series: string | null; volume_number: string | number | null; language: string | null } | null;
  source: { name: string | null } | null;
};
type RawSale = { edition_id: string; print_classification: string | null; known_printing_number: number | null };

export default async function AddSalePage({ searchParams }: AddSalePageProps) {
  const parameters = await searchParams;
  const initialEditionId = typeof parameters.editionId === "string" ? parameters.editionId : "";
  const admin = getSupabaseAdmin();
  const [{ data: profileData }, { data: verifiedEditions }, { data: activeSources }] = await Promise.all([
    admin.from("marketplace_search_profiles")
      .select("id,edition_id,search_query,edition:manga_editions(id,title,series,volume_number,language),source:sources(name)")
      .eq("is_active", true)
      .limit(1000),
    admin.from("manga_editions")
      .select("id,title,series,volume_number,language,isbn_13,publisher")
      .eq("is_verified", true)
      .order("series", { nullsFirst: false })
      .order("volume_number", { nullsFirst: false })
      .limit(2000),
    admin.from("sources").select("id,name").eq("is_active", true).order("name"),
  ]);
  const profiles = ((profileData ?? []) as unknown as SearchProfile[])
    .filter((profile) => profile.source?.name === "eBay Sold" && profile.edition);
  const editionIds = [...new Set(profiles.map((profile) => profile.edition_id))];
  const { data: saleData } = editionIds.length ? await admin.from("price_observations")
    .select("edition_id,print_classification,known_printing_number")
    .in("edition_id", editionIds)
    .eq("match_status", "verified_match")
    .eq("sale_status", "confirmed")
    .is("grading_company", null)
    .is("grade_label", null)
    .limit(5000) : { data: [] };
  const groupCounts = new Map<string, Map<string, number>>();
  for (const sale of (saleData ?? []) as RawSale[]) {
    const groups = groupCounts.get(sale.edition_id) ?? new Map<string, number>();
    const classification = sale.print_classification === "known_later_print"
      ? `known_later_print:${sale.known_printing_number ?? "unknown"}`
      : sale.print_classification ?? "printing_not_identified";
    groups.set(classification, (groups.get(classification) ?? 0) + 1);
    groupCounts.set(sale.edition_id, groups);
  }
  const candidates: SoldSearchCandidate[] = profiles.map((profile) => ({
    profileId: profile.id,
    editionId: profile.edition_id,
    query: profile.search_query,
    title: profile.edition?.title ?? profile.edition?.series ?? "Edition",
    series: profile.edition?.series ?? null,
    volumeNumber: profile.edition?.volume_number ?? null,
    language: profile.edition?.language ?? null,
    comparableRawSales: Math.max(0, ...[...(groupCounts.get(profile.edition_id)?.values() ?? [])]),
  }));
  const nextSearches = prioritiseSoldSearches(candidates, 10);

  return <main className="review-page catalogue-page">
    <header className="site-header"><Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link><Link className="header-note" href="/review">Review queue →</Link><Link className="header-note" href="/price-import">CSV batch import →</Link><StaffNav current="/add-sale" /></header>
    <section className="review-hero catalogue-hero"><div><p className="eyebrow">Staff-approved evidence</p><h1>Add verified sales in bulk</h1><p>Choose the edition once, paste the eBay links, and let RAR fill each listing. Correct only what eBay cannot supply, then publish every ready sale together.</p></div></section>
    <section className="catalogue-content">
      <div className="section-intro"><p className="eyebrow">One decision, not two queues</p><h2>Check it once. Add it properly.</h2><p className="section-copy">Use this for a sale you personally inspected. Your confirmation writes the verified sale, printing decision and audit history together—there is no second edition-match review.</p></div>
      {nextSearches.length ? <section className="sold-search-priorities" aria-labelledby="sold-search-heading">
        <div><p className="eyebrow">Search where the next sale matters</p><h2 id="sold-search-heading">Next completed-listing searches</h2><p>RAR prioritises editions one sale away from a chart or strong coverage. Editions with five comparable raw sales are left out.</p></div>
        <div className="sold-search-priority-list">{nextSearches.map((candidate) => <article key={candidate.profileId}>
          <div><strong>{candidate.title}{candidate.volumeNumber ? ` · Vol. ${candidate.volumeNumber}` : ""}</strong><span>{[candidate.language, `${candidate.comparableRawSales} comparable raw sale${candidate.comparableRawSales === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span><small>{soldSearchReason(candidate.comparableRawSales)}</small></div>
          <div><a href={ebayCompletedSearchUrl(candidate.query)} target="_blank" rel="noreferrer">Search sold listings ↗</a><Link href={`/add-sale?editionId=${candidate.editionId}#bulk-approved-sales`}>Select edition</Link></div>
        </article>)}</div>
      </section> : null}
      <BulkApprovedSalesForm key={initialEditionId || "manual-selection"} initialEditionId={initialEditionId} editions={verifiedEditions ?? []} sources={activeSources ?? []} />
      <details className="single-approved-sale">
        <summary>Add one sale instead</summary>
        <QuickSaleForm initialEditionId={initialEditionId} />
      </details>
      <section className="catalogue-rules" aria-label="Approved listing safeguards"><div><span>1</span><strong>eBay fills the facts</strong><p>One staff-triggered lookup supplies the title, price, date, format and available listing photos.</p></div><div><span>2</span><strong>Markets stay separate</strong><p>Printing, raw copies and every grading company and grade remain distinct.</p></div><div><span>3</span><strong>Your decision teaches</strong><p>RAR retains its detection and your corrections as controlled-learning evidence.</p></div></section>
    </section>
  </main>;
}
