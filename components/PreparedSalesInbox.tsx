"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { OutcomeRow } from "@/components/ListingOutcomesPanel";
import { useStaffReviewer } from "@/lib/useStaffReviewer";

export type NeedsEvidenceItem = {
  id: string;
  editionId: string;
  editionLabel: string;
  listingTitle: string;
  reason: string;
};

function money(value: number | null, currency: string | null) {
  if (value === null || !currency) return "Price unavailable";
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
}

export default function PreparedSalesInbox({ initialRows, needsEvidence }: {
  initialRows: OutcomeRow[];
  needsEvidence: NeedsEvidenceItem[];
}) {
  const router = useRouter();
  const [reviewer, setReviewer] = useStaffReviewer();
  const [rows, setRows] = useState(initialRows);
  const [saving, setSaving] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<Record<string, number>>({});
  const [error, setError] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  useEffect(() => { setRows(initialRows); }, [initialRows]);

  async function decide(row: OutcomeRow, approve: boolean) {
    if (!reviewer.trim()) { setError((current) => ({ ...current, [row.id]: "Add your initials above first." })); return; }
    setSaving(row.id);
    setError((current) => ({ ...current, [row.id]: "" }));
    try {
      const response = await fetch("/api/listing-outcomes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(approve
          ? { action: "approve-prepared-sale", outcomeId: row.id, reviewer: reviewer.trim() }
          : { decision: "dismiss", outcomeId: row.id, reviewer: reviewer.trim(), notes: "Staff denied the prepared sale after reviewing the source evidence." }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error ?? "The decision could not be saved.");
      setRows((current) => current.filter((item) => item.id !== row.id));
      setMessage(approve ? "Sale approved and published." : "Finding denied and removed from the inbox.");
      router.refresh();
    } catch (caught) {
      setError((current) => ({ ...current, [row.id]: caught instanceof Error ? caught.message : "The decision could not be saved." }));
    } finally { setSaving(null); }
  }

  return <section className="prepared-inbox" aria-labelledby="prepared-inbox-heading">
    <div className="coverage-review-heading">
      <div><p className="eyebrow">Prepared sale decisions</p><h2 id="prepared-inbox-heading">{rows.length} ready for Approve or Deny</h2></div>
      <label>Reviewer initials<input aria-label="Reviewer initials for prepared sales" onChange={(event) => setReviewer(event.target.value)} placeholder="Your initials" value={reviewer} /></label>
    </div>
    <p className="coverage-review-intro">RAR has gathered the original eBay check and listing photos below. Approve only after checking the completed sale, one copy, exact edition and suggested copy type. These cards are filed with printing not identified; no first-print claim is inferred.</p>
    {message ? <p className="coverage-review-success" role="status">{message}</p> : null}
    {rows.length ? <div className="prepared-inbox-list">{rows.map((row) => {
      const draft = row.preparedSale!;
      const images = draft.imageUrls;
      const selected = Math.min(selectedImages[row.id] ?? 0, images.length - 1);
      const relevantSpecifics = draft.itemSpecifics.filter((item) => /isbn|publisher|language|format|grader|grade|binding|printing/i.test(item.name)).slice(0, 6);
      return <article className="prepared-sale-card" key={row.id}>
        <div className="prepared-sale-photo">
          <Image alt={`eBay listing photo ${selected + 1} of ${images.length} for ${row.listingTitle}`} height={260} src={images[selected]} unoptimized width={220} />
          {images.length > 1 ? <div className="prepared-sale-thumbs" aria-label="Listing photos">{images.map((url, index) => <button aria-label={`View listing photo ${index + 1}`} aria-pressed={index === selected} key={`${url}-${index}`} onClick={() => setSelectedImages((current) => ({ ...current, [row.id]: index }))} type="button"><Image alt="" height={56} src={url} unoptimized width={48} /></button>)}</div> : null}
        </div>
        <div className="prepared-sale-facts">
          <p className="eyebrow">eBay completed sale · 1 copy</p>
          <h3>{row.listingTitle}</h3>
          <p className="prepared-sale-price">{money(draft.price, draft.currency)}</p>
          <p>Sold {draft.soldAt?.slice(0, 10)} · Checked by eBay {draft.checkedAt?.slice(0, 10)}</p>
          <dl>
            <div><dt>RAR edition</dt><dd>{row.editionLabel}{row.editionDetail ? <small>{row.editionDetail}</small> : null}</dd></div>
            <div><dt>Copy type</dt><dd>{draft.grading === "graded" ? `Graded · ${draft.gradingCompany} ${draft.gradeLabel}` : "Raw / ungraded · suggested from listing"}</dd></div>
            <div><dt>Printing</dt><dd>Not identified — no first-print price claim</dd></div>
          </dl>
          {relevantSpecifics.length ? <details className="prepared-sale-specifics"><summary>eBay item specifics (seller-entered)</summary><ul>{relevantSpecifics.map((item) => <li key={item.name}>{item.name}: {item.values.join(", ")}</li>)}</ul></details> : null}
          <p className="prepared-sale-source"><a href={row.sourceListingUrl} rel="noopener noreferrer" target="_blank">Original eBay listing ↗</a><span>Item {row.externalId}</span></p>
          <div className="coverage-review-actions">
            <button disabled={saving === row.id} onClick={() => void decide(row, true)} type="button">{saving === row.id ? "Saving…" : "Approve sale"}</button>
            <button disabled={saving === row.id} onClick={() => void decide(row, false)} type="button">Deny</button>
          </div>
          {error[row.id] ? <p className="coverage-review-error" role="alert">{error[row.id]}</p> : null}
        </div>
      </article>;
    })}</div> : <p className="coverage-review-empty">No sale is ready for a one-tap decision yet. Incomplete findings are kept below, not published.</p>}
    <details className="prepared-sale-exceptions">
      <summary>Needs more evidence ({needsEvidence.length})</summary>
      <p>These are not ready for one-tap approval. RAR has not established a usable price, single-copy sale, exact grade or printing proof.</p>
      <ul>{needsEvidence.slice(0, 50).map((row) => <li key={row.id}><Link href={`/price-coverage?edition=${encodeURIComponent(row.editionId)}&outcome=${encodeURIComponent(row.id)}`}>{row.editionLabel} · {row.listingTitle}</Link><span>{row.reason}</span></li>)}</ul>
      {needsEvidence.length > 50 ? <p>Showing 50 of {needsEvidence.length}. The edition list below includes the rest.</p> : null}
    </details>
  </section>;
}
