"use client";

import Link from "next/link";
import { useMemo } from "react";
import { buildSeriesProgress, type CatalogueVolume } from "@/lib/seriesCompletion";

type SeriesProgressProps = {
  catalogue: CatalogueVolume[];
  ownedEditionIds: string[];
};

export default function SeriesProgress({ catalogue, ownedEditionIds }: SeriesProgressProps) {
  const owned = useMemo(() => new Set(ownedEditionIds), [ownedEditionIds]);
  const all = useMemo(() => buildSeriesProgress(catalogue, owned), [catalogue, owned]);
  // Only series the collector has actually started. A list of every series in
  // the catalogue with zero owned is a catalogue, not a progress report.
  const started = all.filter((entry) => entry.owned > 0);

  if (!started.length) return null;

  return (
    <section className="series-progress">
      <div className="section-intro">
        <p className="eyebrow">How far through you are</p>
        <h2>Series progress</h2>
        <p className="section-copy">
          Counted against the volumes RAR has catalogued, not the full published run — RAR does not yet track every volume of every series, and will not pretend the set is finished when it only knows part of it.
        </p>
      </div>

      <div className="series-progress-list">
        {started.map((entry) => {
          const complete = entry.owned === entry.tracked;
          const percent = Math.round((entry.owned / entry.tracked) * 100);
          return (
            <article className={`series-progress-row${complete ? " is-complete" : ""}`} key={entry.key}>
              <div className="series-progress-head">
                <div>
                  <h3>{entry.series}</h3>
                  {entry.language ? <span className="series-progress-lang">{entry.language}</span> : null}
                </div>
                <p className="series-progress-count">
                  <strong>{entry.owned}</strong>
                  <span> of {entry.tracked} tracked</span>
                </p>
              </div>

              <div
                aria-label={`${entry.owned} of ${entry.tracked} tracked volumes owned`}
                aria-valuemax={entry.tracked}
                aria-valuemin={0}
                aria-valuenow={entry.owned}
                className="series-progress-track"
                role="progressbar"
              >
                <span className="series-progress-fill" style={{ width: `${percent}%` }} />
              </div>

              <ol className="series-progress-volumes">
                {entry.volumes.map((volume) => (
                  <li key={volume.editionId}>
                    <Link
                      className={volume.owned ? "is-owned" : "is-missing"}
                      href={`/edition/${volume.editionId}`}
                      title={`${volume.title ?? entry.series}${volume.owned ? " — in your collection" : " — not in your collection"}`}
                    >
                      {volume.label}
                    </Link>
                  </li>
                ))}
              </ol>

              {complete
                ? <p className="series-progress-note is-complete-note">You have every volume RAR tracks for this series.</p>
                : <p className="series-progress-note">{entry.tracked - entry.owned} tracked volume{entry.tracked - entry.owned === 1 ? "" : "s"} not in your collection yet.</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
