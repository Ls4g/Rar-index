import Link from "next/link";
import StaffNav from "@/components/StaffNav";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isDue, isStaffFastTrack, planRun, describeRunFairness, type BacklogTarget } from "@/lib/catalogueBacklog";

// What the Catalogue Curator is monitoring and what it will do next.
//
// Built to answer two questions a staff member actually has: why is this title
// on the list, and when will RAR look at it again. Everything else is noise.
export const dynamic = "force-dynamic";

const LANE_LABEL: Record<string, string> = {
  established: "Established",
  rising: "Rising",
  new_release: "New manga",
  series_gap: "Series gaps",
};

const STATUS_NOTE: Record<string, string> = {
  researchable: "Worth searching for a physical edition",
  watching: "No physical volume known to exist yet",
  staged: "A candidate is waiting in catalogue review",
  published: "Already in the catalogue",
  blocked: "Repeatedly found no exact record",
  caught_up: "RAR holds every volume the source reports",
};

function when(value: string | null) {
  if (!value) return "next run";
  const date = new Date(value);
  if (date.getTime() <= Date.now()) return "now";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function titleOf(target: BacklogTarget) {
  return target.title_english || target.title_romaji || target.title_native || target.series_key;
}

export default async function DiscoveryBacklogPage() {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("catalogue_discovery_targets")
    .select("id,discovery_source,external_id,title_english,title_romaji,title_native,series_key,lane,language,score,series_status,reported_volume_count,next_missing_volume,status,source_url,last_checked_at,next_check_at,failure_count,last_result")
    .order("score", { ascending: false, nullsFirst: false })
    .limit(1000);

  const targets = (data ?? []) as BacklogTarget[];
  const researchable = targets.filter((target) => target.status === "researchable");
  // Exactly what the next run would choose, computed with the shipped
  // scheduler rather than described — so the page cannot drift from it.
  const nextRun = planRun(researchable);
  const fairness = describeRunFairness(nextRun);
  const nextRunIds = new Set(nextRun.map((target) => target.id));

  const byLane = new Map<string, BacklogTarget[]>();
  for (const target of targets) byLane.set(target.lane, [...(byLane.get(target.lane) ?? []), target]);

  const gaps = targets.filter((target) => target.lane === "series_gap" && target.status === "researchable");
  const awaitingVolumeOne = targets.filter((target) => target.status === "watching");
  const blocked = targets.filter((target) => target.status === "blocked");
  const caughtUp = targets.filter((target) => target.status === "caught_up");
  const dueNow = targets.filter((target) => isDue(target));
  const fastTrack = targets.filter(isStaffFastTrack);

  return (
    <main className="review-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/agents">Agents →</Link>
        <Link className="header-note" href="/catalogue-review">Catalogue review →</Link>
        <StaffNav current="/discovery-backlog" />
      </header>

      <section className="review-hero catalogue-hero">
        <div>
          <p className="eyebrow">Catalogue Curator</p>
          <h1>Discovery backlog</h1>
          <p>What RAR is monitoring, why each title is here, and when it will be looked at again. Discovery signals only — nothing on this page is evidence of a physical edition, and every candidate still goes through catalogue review.</p>
        </div>
        <div className="queue-total"><strong>{targets.length}</strong><span>targets monitored</span></div>
      </section>

      <section className="catalogue-content">
        {error ? (
          <div className="review-empty"><strong>The discovery backlog is not ready.</strong><p>Apply the 20260827 catalogue discovery migration, then reload. {error.message}</p></div>
        ) : (
          <div className="listing-outcomes">
            <div className="outcome-counts">
              {[
                ["Due now", dueNow.length],
                ["Fast-track", fastTrack.length],
                ["Series gaps", gaps.length],
                ["Awaiting Vol. 1", awaitingVolumeOne.length],
                ["Blocked", blocked.length],
                ["Caught up", caughtUp.length],
              ].map(([label, value]) => (
                <div key={String(label)}><strong>{value}</strong><span>{label}</span></div>
              ))}
            </div>

            {/* The whole point of the rebuild: one series used to take the run.
                Showing the next run explicitly, with its own fairness figures,
                means a regression is visible rather than inferred from a
                queue that has quietly filled with One Piece again. */}
            <div className="outcome-capabilities">
              <strong>Next run: {nextRun.length} targets · {fairness.distinctSeries} series · {fairness.distinctLanes} lanes</strong>
              <ul>
                {nextRun.map((target) => (
                  <li key={target.id}>
                    <span className="ok">→</span>
                    <b>{titleOf(target)}{target.next_missing_volume ? ` Vol. ${target.next_missing_volume}` : ""}</b>
                    {" "}{LANE_LABEL[target.lane] ?? target.lane} · {target.language ?? "—"}
                    {target.failure_count ? ` · ${target.failure_count} previous miss${target.failure_count === 1 ? "" : "es"}` : ""}
                  </li>
                ))}
                {nextRun.length ? null : <li>Nothing is due. The next scheduled check is the earliest time shown below.</li>}
              </ul>
              <p>
                No series may take more than two slots in a run, and the four lanes take turns, so a large series cannot crowd out a small one.
                {fairness.largestSeriesShare > 0 ? ` Largest single series share this run: ${fairness.largestSeriesShare}.` : ""}
              </p>
            </div>

            {Object.keys(LANE_LABEL).map((lane) => {
              const rows = (byLane.get(lane) ?? []).slice(0, 25);
              if (!rows.length) return null;
              return (
                <details className="issue-lineup" key={lane}>
                  <summary>
                    {LANE_LABEL[lane]}
                    <span>{(byLane.get(lane) ?? []).length} targets</span>
                  </summary>
                  <ol className="issue-lineup-list">
                    {rows.map((target) => (
                      <li className={nextRunIds.has(target.id) ? "is-debut" : undefined} key={target.id}>
                        <span className="issue-lineup-work">
                          {titleOf(target)}{target.next_missing_volume ? ` Vol. ${target.next_missing_volume}` : ""}
                          {isStaffFastTrack(target) ? " · FAST-TRACK" : ""}
                        </span>
                        <span className="issue-lineup-creator">
                          <span className="issue-lineup-original">{STATUS_NOTE[target.status] ?? target.status}</span>
                          {target.language ?? "—"}
                          {target.reported_volume_count ? ` · ${target.reported_volume_count} volumes reported` : ""}
                          {target.series_status ? ` · ${target.series_status.toLowerCase()}` : ""}
                          {` · next check ${when(target.next_check_at)}`}
                          {target.last_result ? ` · last: ${target.last_result.replaceAll("_", " ")}` : ""}
                        </span>
                        {nextRunIds.has(target.id) ? <span className="issue-lineup-debut">This run</span> : null}
                      </li>
                    ))}
                  </ol>
                  <p className="issue-lineup-note">
                    {lane === "new_release"
                      ? "Newly started manga are held as watching until a physical volume and a real bibliographic record exist. A serial with no collected volume never becomes an edition."
                      : lane === "series_gap"
                        ? "The next volume RAR would look for in a series it already holds. Existence is never inferred from the previous volume — the search either finds an exact record or the target backs off."
                        : "Discovered from AniList popularity data. That decides what RAR searches for and never what RAR believes: an ISBN, publisher and printing still have to come from a bibliographic source."}
                  </p>
                </details>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
