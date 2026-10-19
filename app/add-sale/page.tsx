import Link from "next/link";
import BulkApprovedSalesForm from "@/components/BulkApprovedSalesForm";
import QuickSaleForm from "@/components/QuickSaleForm";
import StaffNav from "@/components/StaffNav";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { readCompleteRows } from "@/lib/readCompleteRows";
import { ebayCompletedSearchUrl, leadingRawSaleGroupsByPublication, oneSearchPerPublication, prioritiseSoldSearches, publicationIdByEdition, soldSearchReason, type SoldSearchCandidate } from "@/lib/soldSearchPriority";

export const dynamic = "force-dynamic";

type AddSalePageProps = { searchParams: Promise<{ editionId?: string | string[]; gradedLeadId?: string | string[] }> };
type GradedSalePrefill = { leadId: string; editionId: string; sourceListingUrl: string; externalId: string; listingTitle: string };
type SearchProfile = {
  id: string;
  edition_id: string;
  search_query: string;
  edition: { id: string; title: string | null; series: string | null; volume_number: string | number | null; language: string | null; collectible_type: string | null } | null;
  source: { name: string | null } | null;
};
type RawSale = { edition_id: string; print_classification: string | null; known_printing_number: number | null; grading_company: string | null; grade_label: string | null };

export default async function AddSalePage({ searchParams }: AddSalePageProps) {
  const parameters = await searchParams;
  const gradedLeadId = typeof parameters.gradedLeadId === "string" ? parameters.gradedLeadId : "";
  const admin = getSupabaseAdmin();
  let gradedSalePrefill: GradedSalePrefill | null = null;
  if (gradedLeadId) {
    const [{ data: lead }, { data: label }] = await Promise.all([
      admin.from("scout_listing_leads").select("id,profile_id,source_listing_url,external_id,listing_title").eq("id", gradedLeadId).maybeSingle(),
      admin.from("scout_decision_labels").select("id").eq("lead_id", gradedLeadId).eq("label", "graded_not_raw").limit(1).maybeSingle(),
    ]);
    if (lead && label) {
      const { data: profile } = await admin.from("marketplace_search_profiles").select("edition_id").eq("id", lead.profile_id).maybeSingle();
      if (profile?.edition_id) gradedSalePrefill = {
        leadId: lead.id,
        editionId: profile.edition_id,
        sourceListingUrl: lead.source_listing_url,
        externalId: lead.external_id,
        listingTitle: lead.listing_title,
      };
    }
  }
  const initialEditionId = gradedSalePrefill?.editionId ?? (typeof parameters.editionId === "string" ? parameters.editionId : "");
  const [{ data: profileData }, { data: verifiedEditions }, { data: activeSources }] = await Promise.all([
    admin.from("marketplace_search_profiles")
      .select("id,edition_id,search_query,edition:manga_editions(id,title,series,volume_number,language,collectible_type),source:sources(name)")
      .eq("is_active", true)
      .limit(1000),
    admin.from("manga_editions")
      .select("id,title,series,volume_number,language,isbn_13,publisher,format,release_date,printing_of_edition_id")
      .eq("is_verified", true)
      .order("series", { nullsFirst: false })
      .order("volume_number", { nullsFirst: false })
      .limit(2000),
    admin.from("sources").select("id,name").eq("is_active", true).order("name"),
  ]);
  const profiles = ((profileData ?? []) as unknown as SearchProfile[])
    .filter((profile) => profile.source?.name === "eBay Sold" && profile.edition);
  const editionRows = verifiedEditions ?? [];
  const publicationByEdition = publicationIdByEdition(editionRows);
  const editionById = new Map(editionRows.map((edition) => [edition.id, edition]));
  const saleData = profiles.length ? await readCompleteRows<RawSale>("raw sales for search priorities", (from, to) => admin
    .from("price_observations")
    .select("edition_id,print_classification,known_printing_number,grading_company,grade_label")
    .eq("match_status", "verified_match")
    .eq("sale_status", "confirmed")
    .is("grading_company", null)
    .is("grade_label", null)
    .order("id")
    .range(from, to)) : [];
  const leadingGroups = leadingRawSaleGroupsByPublication(editionRows, saleData);
  const publicationProfiles = oneSearchPerPublication(profiles, editionRows, leadingGroups);
  const candidates: SoldSearchCandidate[] = publicationProfiles.map((profile) => {
    const publicationId = publicationByEdition.get(profile.edition_id) ?? profile.edition_id;
    const edition = editionById.get(publicationId);
    return {
      profileId: profile.id,
      editionId: publicationId,
      query: profile.search_query,
      title: edition?.title ?? profile.edition?.title ?? profile.edition?.series ?? "Edition",
      series: edition?.series ?? profile.edition?.series ?? null,
      volumeNumber: edition?.volume_number ?? profile.edition?.volume_number ?? null,
      language: edition?.language ?? profile.edition?.language ?? null,
      collectibleType: profile.edition?.collectible_type ?? "tankobon",
      comparableRawSales: leadingGroups.get(publicationId)?.count ?? 0,
      targetPrintGroup: leadingGroups.get(publicationId)?.classification ?? null,
    };
  });
  const nextSearches = prioritiseSoldSearches(candidates, 10);

  return <main className="review-page catalogue-page">
    <header className="site-header"><Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link><StaffNav current="/add-sale" /></header>
    <section className="review-hero catalogue-hero"><div><p className="eyebrow">Sales</p><h1>{gradedSalePrefill ? "Review a graded sale" : "Add confirmed sales"}</h1><p>{gradedSalePrefill ? "RAR carried over the dismissed lead's original link and proposed edition. Check the eBay result and exact grade, then record it once if it truly sold." : "Already checked a completed eBay listing? Paste its link below. RAR fills what it can; you correct only missing facts and approve once. Other sources are under “Add one sale instead.”"}</p></div></section>
    <section className="catalogue-content">
      {gradedSalePrefill ? <nav className="staff-context-links" aria-label="Graded sales task"><Link href="/graded-revisit">← Back to graded copies</Link></nav> : <nav className="staff-context-links" aria-label="Other sales tasks">
        <Link href="/review?lane=sales">Review possible sales</Link>
        <Link href="/price-coverage">Price coverage by edition</Link>
        <Link href="/price-import">Preflight a sales file</Link>
      </nav>}
      {gradedLeadId && !gradedSalePrefill ? <p role="alert">That graded lead could not be loaded. No listing details were carried over; return to the graded queue and try again.</p> : null}
      <div className="section-intro"><p className="eyebrow">One decision, not two queues</p><h2>Check it once. Add it properly.</h2><p className="section-copy">Use this for a sale you personally inspected. Your confirmation writes the verified sale, printing decision and audit history together—there is no second edition-match review.</p></div>
      {!gradedSalePrefill ? <BulkApprovedSalesForm key={initialEditionId || "manual-selection"} initialEditionId={initialEditionId} editions={verifiedEditions ?? []} sources={activeSources ?? []} /> : null}
      <details className="single-approved-sale" id="graded-approved-sale" open={Boolean(gradedSalePrefill)}>
        <summary>{gradedSalePrefill ? "Confirm this graded sale" : "Add one sale instead"}</summary>
        <QuickSaleForm initialEditionId={initialEditionId} initialGradedLead={gradedSalePrefill} />
      </details>
      {!gradedSalePrefill && nextSearches.length ? <details className="sold-search-priorities sold-search-disclosure">
        <summary>Find your next sale · {nextSearches.length} useful searches</summary>
        <div><p className="eyebrow">Search where the next sale matters</p><h2>Next completed-listing searches</h2><p>Manga one sale from strong coverage come first, followed by manga one sale from unlocking a chart. Magazines and specialist formats follow. Editions with five comparable raw sales are left out.</p></div>
        <div className="sold-search-priority-list">{nextSearches.map((candidate) => <article key={candidate.profileId}>
          <div><strong>{candidate.title}{candidate.volumeNumber ? ` · Vol. ${candidate.volumeNumber}` : ""}</strong><span>{[candidate.collectibleType === "zasshi" ? "Magazine issue" : candidate.collectibleType === "tankobon" || !candidate.collectibleType ? "Manga" : candidate.collectibleType.replaceAll("_", " "), candidate.language, `${candidate.comparableRawSales} comparable raw sale${candidate.comparableRawSales === 1 ? "" : "s"}`, candidate.targetPrintGroup === "first_print_proven" ? "First print" : candidate.targetPrintGroup === "printing_not_identified" ? "Printing unidentified" : candidate.targetPrintGroup?.startsWith("known_later_print") ? "Later printing" : null].filter(Boolean).join(" · ")}</span><small>{soldSearchReason(candidate.comparableRawSales, candidate.collectibleType)}</small></div>
          <div><a href={ebayCompletedSearchUrl(candidate.query)} target="_blank" rel="noreferrer">Search sold listings ↗</a><Link href={`/add-sale?editionId=${candidate.editionId}#bulk-approved-sales`}>Select edition</Link></div>
        </article>)}</div>
      </details> : null}
      {!gradedSalePrefill ? <section className="catalogue-rules" aria-label="Approved listing safeguards"><div><span>1</span><strong>eBay fills the facts</strong><p>One staff-triggered lookup supplies the title, price, date, format and available listing photos.</p></div><div><span>2</span><strong>Markets stay separate</strong><p>Printing, raw copies and every grading company and grade remain distinct.</p></div><div><span>3</span><strong>Your decision teaches</strong><p>RAR retains its detection and your corrections as controlled-learning evidence.</p></div></section> : null}
    </section>
  </main>;
}
