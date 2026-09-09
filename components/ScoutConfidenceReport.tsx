import type { measureScoutConfidence } from "@/lib/scoutLearningEvidence";

export default function ScoutConfidenceReport({ report }: { report: ReturnType<typeof measureScoutConfidence> | null }) {
  return <section className="agent-control-content scout-confidence-report">
    <div className="section-intro"><p className="eyebrow">Learning from your reviews</p><h2>How reliable are the match scores?</h2>
      <p>Current scores replayed against staff-labelled edition decisions. These results describe reviewed listings; they do not measure sold status or prove a printing.</p>
    </div>
    {!report ? <p role="status">The confidence report could not load. Try again later.</p> : <>
      {report.buckets.length ? <div className="scout-confidence-grid">{report.buckets.map(row => <article key={`${row.language}-${row.kind}-${row.band}`}>
        <h3>{row.language} · {row.kind}</h3><p>Match score: <strong>{row.band}</strong></p>
        <p><strong>{row.matches} of {row.samples}</strong> labelled as exact matches</p>
        {row.enoughEvidence ? <p>{row.observedMatchPercent}% observed match rate <small>(95% interval: {row.interval.low}–{row.interval.high}%)</small></p>
          : <p>Early evidence — 20 independent examples needed for a rate.</p>}
      </article>)}</div> : <p>No explicit edition-match labels are available yet. Your usual reviews will fill this report automatically.</p>}
      <p>{report.excluded} groups excluded because the reason does not establish edition identity or the labels disagree. Duplicate captures count once.</p>
    </>}
    <details><summary>How improvements are tested</summary><p>A reserved fifth of listing groups stays out of suggested examples and rule-development proposals. New rules must improve on the active scorer using fresh reserved decisions collected after their creation, while preserving previous exact matches. More examples arrive through normal reviews.</p></details>
  </section>;
}
