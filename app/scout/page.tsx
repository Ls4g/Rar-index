import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import ScoutRunButton from "@/components/ScoutRunButton";
import ScoutLeadDecisionForm from "@/components/ScoutLeadDecisionForm";

export const dynamic = "force-dynamic";

type Profile = {
  id: string;
  search_query: string;
  edition: { title: string | null; language: string | null; isbn_13: string | null } | null;
  source: { name: string | null } | null;
};

type Lead = {
  id: string;
  profile_id: string;
  source_listing_url: string;
  listing_title: string;
  listing_price: number | null;
  currency: string | null;
  listing_condition: string | null;
  item_end_at: string | null;
  last_seen_at: string;
  match_assessment: { confidence?: string; score?: number } | null;
  review_status: "new" | "watching" | "dismissed";
  review_notes: string | null;
  reviewed_by: string | null;
};

function formatPrice(value: number | null, currency: string | null) {
  if (value === null || !currency) return "Price not listed";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "No end date supplied";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

export default async function ScoutPage() {
  const admin = getSupabaseAdmin();
  const { data: profileData } = await admin
    .from("marketplace_search_profiles")
    .select("id,search_query,edition:manga_editions(title,language,isbn_13),source:sources(name)")
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  const profiles = (profileData ?? []) as unknown as Profile[];
  const profileIds = profiles.map((profile) => profile.id);
  const { data: leadData } = profileIds.length
    ? await admin.from("scout_listing_leads").select("id,profile_id,source_listing_url,listing_title,listing_price,currency,listing_condition,item_end_at,last_seen_at,match_assessment,review_status,review_notes,reviewed_by").in("profile_id", profileIds).neq("review_status", "dismissed").order("last_seen_at", { ascending: false }).limit(100)
    : { data: [] };
  const leadsByProfile = new Map<string, Lead[]>();
  for (const lead of (leadData ?? []) as Lead[]) {
    const leads = leadsByProfile.get(lead.profile_id) ?? [];
    leads.push(lead);
    leadsByProfile.set(lead.profile_id, leads);
  }

  return <main className="review-page catalogue-page">
    <header className="site-header">
      <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
      <Link className="header-note" href="/collection-profiles">Collection profiles →</Link>
    </header>
    <section className="review-hero catalogue-hero">
      <div><p className="eyebrow">RAR Scout</p><h1>Active listing leads</h1><p>Scout finds currently available listings using the official eBay Browse API. These are research leads only: they never enter sales history, valuation, or charts.</p></div>
      <div className="queue-total"><strong>{profiles.length}</strong><span>active search profiles</span></div>
    </section>
    <section className="review-list-section">
      <div className="section-intro"><p className="eyebrow">Safe automation</p><h2>Discover, then inspect</h2><p className="section-copy">Run a narrow scan for an exact RAR edition. Open any lead to inspect its edition and copyright page before treating it as useful evidence.</p></div>
      {profiles.length ? <div className="review-list">{profiles.map((profile) => {
        const leads = leadsByProfile.get(profile.id) ?? [];
        return <article className="review-card catalogue-card" key={profile.id}>
          <div className="review-card-topline"><span>{profile.source?.name ?? "Marketplace"}</span><span>{leads.length} stored active leads</span></div>
          <div className="review-card-main"><div><h3>{profile.edition?.title ?? "Edition"}</h3><p className="review-condition">{[profile.edition?.language, profile.edition?.isbn_13 ? `ISBN ${profile.edition.isbn_13}` : null].filter(Boolean).join(" · ")}</p></div></div>
          <div className="review-note"><span>Scout query</span><p>{profile.search_query}</p></div>
          <ScoutRunButton profileId={profile.id} />
          <div className="review-note"><span>Latest active leads</span>{leads.length ? <div className="review-list">{leads.slice(0, 10).map((lead) => <article className="review-card" key={lead.id}><div className="review-card-main"><div><h4><a href={lead.source_listing_url} target="_blank" rel="noreferrer">{lead.listing_title}</a></h4><p>{formatPrice(lead.listing_price, lead.currency)} · {lead.listing_condition ?? "Condition not supplied"} · ends {formatDate(lead.item_end_at)}</p></div><span className={`sale-status ${lead.review_status}`}>{lead.review_status}</span></div><p>{lead.match_assessment?.score !== undefined ? `${lead.match_assessment.confidence ?? "unknown"} match signal (${lead.match_assessment.score}/100)` : "No match signal recorded"}</p>{lead.review_status === "new" ? <ScoutLeadDecisionForm leadId={lead.id} /> : <p>{lead.review_notes ?? "No review note recorded."}{lead.reviewed_by ? ` — ${lead.reviewed_by}` : ""}</p>}</article>)}</div> : <p>No active leads stored yet. Configure eBay Scout in Vercel, then run a scan.</p>}</div>
        </article>;
      })}</div> : <div className="review-empty"><strong>No active profiles yet.</strong><p>Create an exact-edition eBay profile before Scout can run.</p></div>}
    </section>
  </main>;
}
