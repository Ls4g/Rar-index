"use client";

import Link from "next/link";
import { useRef, useState } from "react";

export type QualityCover = {
  editionId: string;
  series: string | null;
  title: string | null;
  volumeNumber: string | null;
  publisher: string | null;
  language: string | null;
  coverImageUrl: string;
};

type Measured = QualityCover & { width: number; height: number; failed: boolean };

// Wide enough to stay sharp in the gallery's big In hand view on a high-DPI
// screen. Below it a cover visibly blurs when shown large.
const THRESHOLDS = [400, 500, 700] as const;

function measure(url: string): Promise<{ width: number; height: number; failed: boolean }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    const timer = window.setTimeout(() => resolve({ width: 0, height: 0, failed: true }), 20000);
    img.onload = () => { window.clearTimeout(timer); resolve({ width: img.naturalWidth, height: img.naturalHeight, failed: !img.naturalWidth }); };
    img.onerror = () => { window.clearTimeout(timer); resolve({ width: 0, height: 0, failed: true }); };
    img.src = url;
  });
}

function sourceHost(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "unknown source"; }
}

function editionLabel(cover: QualityCover) {
  const name = cover.series ?? cover.title ?? "Untitled edition";
  return cover.volumeNumber ? `${name}, Vol. ${cover.volumeNumber}` : name;
}

// Runs in the staff member's own browser, which can load every cover host
// (the server and the database cannot). Nothing is saved: it only lists the
// covers that are too small, each linked to the existing replace-cover flow.
export default function CoverQualityCheck({ covers }: { covers: QualityCover[] }) {
  const [results, setResults] = useState<Measured[] | null>(null);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [threshold, setThreshold] = useState<number>(500);
  const runId = useRef(0);

  async function run() {
    const id = ++runId.current;
    setRunning(true);
    setProgress(0);
    setResults(null);
    const out: Measured[] = new Array(covers.length);
    let next = 0;
    let done = 0;
    async function worker() {
      while (next < covers.length) {
        const index = next++;
        const size = await measure(covers[index].coverImageUrl);
        out[index] = { ...covers[index], ...size };
        done += 1;
        if (runId.current === id && (done % 10 === 0 || done === covers.length)) setProgress(done);
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker));
    if (runId.current !== id) return;
    setResults(out);
    setRunning(false);
  }

  const failed = results?.filter((row) => row.failed) ?? [];
  const small = (results?.filter((row) => !row.failed && row.width < threshold) ?? []).sort((a, b) => a.width - b.width);
  const sharp = results ? results.length - failed.length - small.length : 0;

  return (
    <section className="cover-quality">
      <div className="cover-quality-head">
        <div>
          <p className="eyebrow">Image quality</p>
          <h2>Check verified covers for sharpness</h2>
          <p>Measures every verified cover in your browser and lists the ones too small to look sharp when shown large, smallest first. Nothing is changed: use “Find a better cover” to replace one.</p>
        </div>
        <div className="cover-quality-actions">
          <label>Flag covers narrower than
            <select value={threshold} onChange={(event) => setThreshold(Number(event.target.value))}>
              {THRESHOLDS.map((value) => <option key={value} value={value}>{value}px</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void run()} disabled={running || !covers.length}>
            {running ? `Measuring ${progress} of ${covers.length}…` : results ? "Measure again" : `Measure ${covers.length} covers`}
          </button>
        </div>
      </div>

      {results ? <>
        <p className="cover-quality-summary" role="status">
          <strong>{small.length}</strong> too small · <strong>{failed.length}</strong> did not load · {sharp} at {threshold}px wide or more
        </p>
        {small.length || failed.length ? (
          <ol className="cover-quality-list">
            {[...failed, ...small].map((row) => (
              <li key={row.editionId}>
                {/* eslint-disable-next-line @next/next/no-img-element -- staff checks external source images */}
                {row.failed ? <span className="cover-quality-thumb is-missing">No image</span> : <img className="cover-quality-thumb" src={row.coverImageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                <div>
                  <strong>{editionLabel(row)}</strong>
                  <span>{[row.publisher, row.language].filter(Boolean).join(" · ")}</span>
                  <span className={row.failed ? "cover-quality-size is-bad" : row.width < 300 ? "cover-quality-size is-bad" : "cover-quality-size"}>
                    {row.failed ? "Image did not load" : `${row.width} × ${row.height} px`} · {sourceHost(row.coverImageUrl)}
                  </span>
                </div>
                <Link href={`/cover-review?edition=${row.editionId}#edition-${row.editionId}`}>Find a better cover</Link>
              </li>
            ))}
          </ol>
        ) : <p className="cover-quality-summary">Every verified cover is at least {threshold}px wide.</p>}
      </> : null}
    </section>
  );
}
