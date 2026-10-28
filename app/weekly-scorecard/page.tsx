import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { readCompleteRows } from "@/lib/readCompleteRows";
import { buildWeeklyScorecard, scorecardStart, type ScorecardEvent, type ScorecardReview, type ScorecardRun } from "@/lib/weeklyScorecard";
import StaffNav from "@/components/StaffNav";

export const dynamic = "force-dynamic";

export default async function WeeklyScorecardPage() {
  const admin = getSupabaseAdmin();
  const now = new Date();
  const start = scorecardStart(now).toISOString();
  let scorecard: ReturnType<typeof buildWeeklyScorecard> | null = null;
  let dataError = "";
  try {
    const [runs, reviews, events] = await Promise.all([
      readCompleteRows<ScorecardRun>("Apify run logs", (from, to) => admin.from("cron_invocations")
        .select("started_at,status,summary").eq("route", "/api/cron/apify-sales")
        .gte("started_at", start).order("started_at", { ascending: true }).range(from, to)),
      readCompleteRows<ScorecardReview>("Apify review outcomes", (from, to) => admin.from("listing_outcomes")
        .select("reviewed_at,reviewed_by,resulting_observation_id,discovery_provider:original_snapshot->>provider")
        .gte("reviewed_at", start).not("reviewed_by", "is", null)
        .order("reviewed_at", { ascending: true }).range(from, to)),
      readCompleteRows<ScorecardEvent>("public journey counters", (from, to) => admin.from("public_journey_events")
        .select("created_at,event_type").gte("created_at", start)
        .order("created_at", { ascending: true }).range(from, to)),
    ]);
    scorecard = buildWeeklyScorecard(runs, reviews, events, now);
  } catch {
    dataError = "The scorecard could not load all its source data. No partial totals are shown; please retry.";
  }

  return <main className="review-page catalogue-page">
    <header className="site-header">
      <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
      <StaffNav current="/weekly-scorecard" />
    </header>
    <section className="review-hero catalogue-hero"><div>
      <p className="eyebrow">Internal performance</p><h1>Weekly scorecard</h1>
      <p>Last seven UTC calendar days. Shows what the automated sales search found, what staff confirmed, and which collector actions happened on RAR. These are activity counts—not valuations or a claim that a visitor bought a copy.</p>
    </div></section>
    <section className="catalogue-content">
      {dataError ? <p className="status-message" role="alert">{dataError}</p> : scorecard ? <>
        <div className="catalogue-rules scorecard-summary">
          <div><span>{scorecard.loggedRuns ? scorecard.total.searches : "—"}</span><strong>Edition searches</strong><p>From logged daily Apify runs.</p></div>
          <div><span>{scorecard.loggedRuns ? scorecard.total.findings : "—"}</span><strong>Raw findings</strong><p>Listings returned before filtering.</p></div>
          <div><span>{scorecard.loggedRuns ? scorecard.total.queued : "—"}</span><strong>Sent to inbox</strong><p>Search leads needing human review.</p></div>
          <div><span>{scorecard.total.reviewed}</span><strong>Apify leads reviewed</strong><p>Staff decisions recorded this week.</p></div>
          <div><span>{scorecard.total.confirmedSales}</span><strong>Confirmed sales</strong><p>Reviewed Apify leads linked to a sale.</p></div>
        </div>
        <section className="review-list-section workbench-section">
          <div className="section-intro"><p className="eyebrow">Collector activity</p><h2>Are people using the data?</h2><p className="section-copy">Anonymous event counts began with this release. They are directional, not unique visitors. No search terms, identities or destination URLs are stored.</p></div>
          <div className="catalogue-rules scorecard-summary">
            <div><span>{scorecard.total.catalogueSearches}</span><strong>Homepage searches</strong><p>Submitted or selected from suggestions.</p></div>
            <div><span>{scorecard.total.editionViews}</span><strong>Edition views</strong><p>Pages opened in a browser.</p></div>
            <div><span>{scorecard.total.shelfAdds}</span><strong>Shelf additions</strong><p>New holdings saved successfully.</p></div>
            <div><span>{scorecard.total.listingClicks}</span><strong>Listing clicks</strong><p>Clicks out to live listings, not purchases.</p></div>
          </div>
        </section>
        <section className="review-list-section workbench-section">
          <div className="section-intro"><p className="eyebrow">Daily breakdown</p><h2>What changed each day</h2><p className="section-copy">The sales columns are grouped by when each action occurred, not a matched cohort. A finding reviewed later may appear on a different day. A dash means no run log is available, not necessarily no search.</p></div>
          <div className="readiness-table-wrap"><table><thead><tr><th>UTC day</th><th>Searched</th><th>Found</th><th>Queued</th><th>Reviewed</th><th>Sales</th><th>Searches</th><th>Views</th><th>Shelf adds</th><th>Listing clicks</th></tr></thead><tbody>
            {[...scorecard.days].reverse().map((day) => <tr key={day.day}><td><strong>{day.day}</strong></td><td>{day.loggedRuns ? day.searches : "—"}</td><td>{day.loggedRuns ? day.findings : "—"}</td><td>{day.loggedRuns ? day.queued : "—"}</td><td>{day.reviewed}</td><td>{day.confirmedSales}</td><td>{day.catalogueSearches}</td><td>{day.editionViews}</td><td>{day.shelfAdds}</td><td>{day.listingClicks}</td></tr>)}
          </tbody></table></div>
        </section>
        <p className="scorecard-footnote">{scorecard.loggedRuns} Apify run logs available · {scorecard.failedRuns} failed or partial · recorded spend ${scorecard.spentUsd.toFixed(3)}. Earlier searches whose log entries failed cannot be reconstructed here. “Reviewed” and “confirmed sales” count Apify-origin decisions only; manual sale entries are outside this funnel. No hands-on review time is recorded yet.</p>
      </> : null}
    </section>
  </main>;
}
