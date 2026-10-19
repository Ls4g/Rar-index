"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { OutcomeRow } from "@/components/ListingOutcomesPanel";
import { outcomeIsBestOffer } from "@/lib/outcomeSaleConfirmation";
import { useStaffReviewer } from "@/lib/useStaffReviewer";

type SaleInput = {
  total: string;
  fee: string;
  currency: string;
  date: string;
  grading: string;
  company: string;
  grade: string;
  inspected: boolean;
};

function initialInput(row: OutcomeRow): SaleInput {
  return {
    total: row.soldPrice === null ? "" : String(row.soldPrice),
    fee: "",
    currency: row.soldCurrency ?? row.currency ?? "USD",
    date: row.soldAt?.slice(0, 10) ?? "",
    grading: "",
    company: "",
    grade: "",
    inspected: false,
  };
}

function money(value: number | null, currency: string | null) {
  if (value === null || !currency) return null;
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
}

async function postDecision(body: Record<string, unknown>) {
  const response = await fetch("/api/listing-outcomes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as { error?: string; ok?: boolean };
  if (!response.ok || result.error) throw new Error(result.error ?? "The decision could not be saved.");
}

export default function PriceCoverageReview({ editionId, initialRows }: { editionId: string; initialRows: OutcomeRow[] }) {
  const router = useRouter();
  const [reviewer, setReviewer] = useStaffReviewer();
  const [rows, setRows] = useState(initialRows);
  const [openId, setOpenId] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, SaleInput>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState("");

  // A failed second step may leave an audited sold candidate (but no verified
  // sale). Refreshing must show that new state so retry skips price recording.
  useEffect(() => { setRows(initialRows); }, [initialRows]);

  function updateInput(id: string, row: OutcomeRow, patch: Partial<SaleInput>) {
    setInputs((current) => ({ ...current, [id]: { ...(current[id] ?? initialInput(row)), ...patch } }));
  }

  async function decide(row: OutcomeRow, decision: "mark_unsold" | "wrong_edition" | "dismiss" | "keep_watching") {
    if (!reviewer.trim()) { setErrors((current) => ({ ...current, [row.id]: "Enter your initials above first." })); return; }
    setSavingId(row.id);
    setErrors((current) => ({ ...current, [row.id]: "" }));
    try {
      await postDecision({ outcomeId: row.id, decision, reviewer: reviewer.trim() });
      setRows((current) => current.filter((item) => item.id !== row.id));
      setSuccess("Decision saved. The finding has left this queue.");
      router.refresh();
    } catch (error) {
      setErrors((current) => ({ ...current, [row.id]: error instanceof Error ? error.message : "The decision could not be saved." }));
    } finally { setSavingId(null); }
  }

  async function approve(row: OutcomeRow) {
    const input = inputs[row.id] ?? initialInput(row);
    if (!reviewer.trim()) { setErrors((current) => ({ ...current, [row.id]: "Enter your initials above first." })); return; }
    if (!input.inspected) { setErrors((current) => ({ ...current, [row.id]: "Confirm that you checked the original sold page and this exact edition." })); return; }
    setSavingId(row.id);
    setErrors((current) => ({ ...current, [row.id]: "" }));
    try {
      // The first write only records what the reviewer saw on eBay. The second
      // invokes the existing atomic sale-confirmation path, with its exact
      // edition and completed-source guards. Apify never verifies a sale.
      const alreadyPriced = row.status === "sold_candidate" && row.soldPrice !== null && Boolean(row.soldCurrency && row.soldAt);
      if (!alreadyPriced) {
        await postDecision({
          action: outcomeIsBestOffer(row.buyingFormat, row.listingTitle) ? "record-best-offer-price" : "record-observed-sale",
          outcomeId: row.id,
          reviewer: reviewer.trim(),
          displayedTotal: Number(input.total),
          buyerProtectionFee: Number(input.fee || 0),
          soldCurrency: input.currency,
          soldAt: input.date,
        });
      }
      await postDecision({
        outcomeId: row.id,
        decision: "confirm_sale",
        reviewer: reviewer.trim(),
        humanConfirmed: true,
        grading: input.grading,
        gradingCompany: input.company,
        gradeLabel: input.grade,
      });
      setRows((current) => current.filter((item) => item.id !== row.id));
      setOpenId(null);
      setSuccess("Sale verified. The edition’s count has been updated.");
      router.refresh();
    } catch (error) {
      setErrors((current) => ({ ...current, [row.id]: `${error instanceof Error ? error.message : "The sale could not be verified."} If the observed price was saved, refresh before retrying; no unverified sale was added to the chart.` }));
      router.refresh();
    } finally { setSavingId(null); }
  }

  return <section className="coverage-review" aria-label="Sales findings">
    <div className="coverage-review-heading">
      <div><p className="eyebrow">Sales findings</p><h2>{rows.length} to review</h2></div>
      <label>Reviewer initials<input aria-label="Reviewer initials" onChange={(event) => setReviewer(event.target.value)} placeholder="Your initials" value={reviewer} /></label>
    </div>
    <p className="coverage-review-intro">Open the original eBay page before deciding. A search result alone is not proof that a listing sold.</p>
    {success ? <p className="coverage-review-success" role="status">{success}</p> : null}
    {!rows.length ? <p className="coverage-review-empty">No unresolved findings for this edition. Try Find sales, or move to another edition.</p> : null}
    <div className="coverage-review-list">{rows.map((row) => {
      const input = inputs[row.id] ?? initialInput(row);
      const expanded = openId === row.id;
      const busy = savingId === row.id;
      const alreadyPriced = row.status === "sold_candidate" && row.soldPrice !== null && Boolean(row.soldCurrency && row.soldAt);
      return <article className="coverage-review-card" key={row.id}>
        {row.imageUrl ? <Image alt="" className="coverage-review-cover" height={112} loading="lazy" src={row.imageUrl} unoptimized width={84} /> : null}
        <div className="coverage-review-body">
          <div className="coverage-review-top"><span>{alreadyPriced ? "Sale details available" : "Needs sale check"}</span><span>{row.matchScore !== null ? `Match ${row.matchScore}` : ""}</span></div>
          <h3>{row.listingTitle}</h3>
          <p>{alreadyPriced ? `${money(row.soldPrice, row.soldCurrency)} · ${row.soldAt?.slice(0, 10)}` : "Sale and paid price not yet verified"}{row.matchConflicts.length ? ` · Caution: ${row.matchConflicts[0]}` : ""}</p>
          <a href={row.sourceListingUrl} rel="noopener noreferrer" target="_blank">Open original eBay listing ↗</a>
          <div className="coverage-review-actions">
            <button disabled={busy} onClick={() => setOpenId(expanded ? null : row.id)} type="button">{expanded ? "Close sale form" : "Approve sale"}</button>
            <button disabled={busy} onClick={() => void decide(row, "mark_unsold")} type="button">Not sold</button>
            <button disabled={busy} onClick={() => void decide(row, "wrong_edition")} type="button">Wrong edition</button>
            <button disabled={busy} onClick={() => void decide(row, "dismiss")} type="button">Can’t verify</button>
            {row.status !== "sold_candidate" ? <button disabled={busy} onClick={() => void decide(row, "keep_watching")} type="button">Still live</button> : null}
          </div>
          {expanded ? <form className="coverage-review-form" onSubmit={(event) => { event.preventDefault(); void approve(row); }}>
            {!alreadyPriced ? <div className="coverage-review-fields">
              <label>eBay displayed total<input min="0.01" onChange={(event) => updateInput(row.id, row, { total: event.target.value })} required step="0.01" type="number" value={input.total} /></label>
              <label>Buyer Protection fee<input min="0" onChange={(event) => updateInput(row.id, row, { fee: event.target.value })} placeholder="0 if none" step="0.01" type="number" value={input.fee} /></label>
              <label>Currency<select onChange={(event) => updateInput(row.id, row, { currency: event.target.value })} value={input.currency}>{["GBP", "USD", "EUR", "JPY", "CAD", "AUD"].map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
              <label>Sold date<input max={new Date().toISOString().slice(0, 10)} onChange={(event) => updateInput(row.id, row, { date: event.target.value })} required type="date" value={input.date} /></label>
            </div> : null}
            <div className="coverage-review-fields">
              <label>Copy type<select onChange={(event) => updateInput(row.id, row, { grading: event.target.value })} required value={input.grading}><option value="">Choose</option><option value="raw">Raw / ungraded</option><option value="graded">Graded</option></select></label>
              {input.grading === "graded" ? <><label>Grading company<input onChange={(event) => updateInput(row.id, row, { company: event.target.value })} required value={input.company} /></label><label>Exact grade<input onChange={(event) => updateInput(row.id, row, { grade: event.target.value })} required value={input.grade} /></label></> : null}
            </div>
            <label className="coverage-review-confirm"><input checked={input.inspected} onChange={(event) => updateInput(row.id, row, { inspected: event.target.checked })} required type="checkbox" /> I opened the working original page and checked it says sold, the paid item price, one copy, and the exact RAR edition including printing.</label>
            <button disabled={busy} type="submit">{busy ? "Saving…" : "Verify sale"}</button>
          </form> : null}
          {errors[row.id] ? <p className="coverage-review-error" role="alert">{errors[row.id]}</p> : null}
          <Link className="coverage-review-more" href={`/price-coverage?edition=${encodeURIComponent(editionId)}&outcome=${encodeURIComponent(row.id)}`}>Full evidence and review tools</Link>
        </div>
      </article>;
    })}</div>
  </section>;
}
