import Link from "next/link";
import GradedRevisitQueue, { type GradedRevisitGroup } from "@/components/GradedRevisitQueue";
import StaffNav from "@/components/StaffNav";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type LabelRow = { id: string; lead_id: string; decision_id: string; created_at: string };
type LeadRow = {
  id: string; source_id: string; external_id: string; profile_id: string;
  source_listing_url: string; listing_title: string; listing_price: number | null;
  currency: string | null; last_seen_at: string;
  review_status: "new" | "watching" | "dismissed";
};
type DecisionRow = { id: string; lead_id: string; decision_notes: string | null; created_at: string };
type ProfileRow = { id: string; edition_id: string; edition: { title: string | null; series: string | null; volume_number: number | null; language: string | null } | null };
type OutcomeRow = { external_id: string; status: string };

function later(a: { created_at: string; id: string }, b: { created_at: string; id: string }) {
  return a.created_at > b.created_at || (a.created_at === b.created_at && a.id > b.id);
}

export default async function GradedRevisitPage() {
  const admin = getSupabaseAdmin();
  const { data: labelData, error: labelError } = await admin
    .from("scout_decision_labels")
    .select("id,lead_id,decision_id,created_at")
    .eq("label", "graded_not_raw")
    .order("created_at", { ascending: false });
  const labels = (labelData ?? []) as LabelRow[];
  const leadIds = [...new Set(labels.map((row) => row.lead_id))];
  const [leadResult, decisionResult] = leadIds.length ? await Promise.all([
    admin.from("scout_listing_leads")
      .select("id,source_id,external_id,profile_id,source_listing_url,listing_title,listing_price,currency,last_seen_at,review_status")
      .in("id", leadIds),
    admin.from("scout_lead_decisions")
      .select("id,lead_id,decision_notes,created_at")
      .in("lead_id", leadIds),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  const leads = (leadResult.data ?? []) as LeadRow[];
  const decisions = (decisionResult.data ?? []) as DecisionRow[];
  const profileIds = [...new Set(leads.map((row) => row.profile_id))];
  const externalIds = [...new Set(leads.map((row) => row.external_id))];
  const [profileResult, outcomeResult] = await Promise.all([
    profileIds.length ? admin.from("marketplace_search_profiles")
      .select("id,edition_id,edition:manga_editions(title,series,volume_number,language)")
      .in("id", profileIds) : Promise.resolve({ data: [], error: null }),
    externalIds.length ? admin.from("listing_outcomes").select("external_id,status").in("external_id", externalIds) : Promise.resolve({ data: [], error: null }),
  ]);

  const error = labelError || leadResult.error || decisionResult.error || profileResult.error || outcomeResult.error;
  const latestLabel = new Map<string, LabelRow>();
  for (const label of labels) {
    const current = latestLabel.get(label.lead_id);
    if (!current || later(label, current)) latestLabel.set(label.lead_id, label);
  }
  const decisionById = new Map(decisions.map((row) => [row.id, row]));
  const latestDecision = new Map<string, DecisionRow>();
  for (const decision of decisions) {
    const current = latestDecision.get(decision.lead_id);
    if (!current || later(decision, current)) latestDecision.set(decision.lead_id, decision);
  }
  const profiles = new Map(((profileResult.data ?? []) as unknown as ProfileRow[]).map((row) => [row.id, row]));
  const outcomes = new Map(((outcomeResult.data ?? []) as OutcomeRow[]).map((row) => [row.external_id, row.status]));
  const groupMap = new Map<string, GradedRevisitGroup>();
  for (const lead of leads) {
    const label = latestLabel.get(lead.id);
    if (!label) continue;
    const profile = profiles.get(lead.profile_id);
    const edition = profile?.edition;
    const key = `${lead.source_id}:${lead.external_id}`;
    const group = groupMap.get(key) ?? {
      key,
      title: lead.listing_title,
      url: lead.source_listing_url,
      price: lead.listing_price,
      currency: lead.currency,
      lastSeenAt: lead.last_seen_at,
      outcomeStatus: outcomes.get(lead.external_id) ?? null,
      leads: [],
    };
    if (lead.last_seen_at > group.lastSeenAt) {
      group.lastSeenAt = lead.last_seen_at;
      group.title = lead.listing_title;
      group.url = lead.source_listing_url;
      group.price = lead.listing_price;
      group.currency = lead.currency;
    }
    group.leads.push({
      id: lead.id,
      editionId: profile?.edition_id ?? null,
      editionTitle: [edition?.series || edition?.title || "Edition", edition?.volume_number ? `Vol. ${edition.volume_number}` : null, edition?.language].filter(Boolean).join(" · "),
      reviewStatus: lead.review_status,
      pending: lead.review_status === "dismissed" && latestDecision.get(lead.id)?.id === label.decision_id,
      originalNote: decisionById.get(label.decision_id)?.decision_notes ?? null,
    });
    groupMap.set(key, group);
  }
  const groups = [...groupMap.values()].sort((a, b) => {
    const aPending = a.leads.some((lead) => lead.pending);
    const bPending = b.leads.some((lead) => lead.pending);
    if (aPending !== bPending) return aPending ? -1 : 1;
    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  });

  return (
    <main className="review-page graded-revisit-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <StaffNav current="/graded-revisit" />
      </header>
      <section className="review-hero">
        <div>
          <p className="eyebrow">Scout · separate research queue</p>
          <h1>Graded copies to revisit</h1>
          <p>These are the listings you dismissed because they were graded, not raw. Recheck each original listing when you have time. An asking price or a missing listing is never a verified sale.</p>
          <Link className="header-note" href="/scout">← Back to live listing Scout</Link>
        </div>
        <div className="queue-total"><strong>{groups.length}</strong><span>distinct graded listings saved · {leads.length} edition decisions retained</span></div>
      </section>
      {error ? <section className="catalogue-content"><p role="alert">The graded queue could not load fully. Please refresh before making decisions.</p></section> : <GradedRevisitQueue initialGroups={groups} />}
    </main>
  );
}
