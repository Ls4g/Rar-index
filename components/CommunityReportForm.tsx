"use client";

import { useState } from "react";

type ReportType = "sale" | "pricing_issue" | "edition_issue";

export default function CommunityReportForm({ editionId, editionTitle }: { editionId: string; editionTitle: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [reportType, setReportType] = useState<ReportType>("sale");
  const [sourceUrl, setSourceUrl] = useState("");
  const [listingTitle, setListingTitle] = useState("");
  const [reportedPrice, setReportedPrice] = useState("");
  const [currency, setCurrency] = useState("");
  const [soldDate, setSoldDate] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/community-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editionId, reportType, sourceUrl, listingTitle, reportedPrice, currency, soldDate, notes, website }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The report could not be sent.");
      setMessage("Thanks — your report is in the RAR review queue. It will not change the price automatically.");
      setSourceUrl("");
      setListingTitle("");
      setReportedPrice("");
      setCurrency("");
      setSoldDate("");
      setNotes("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The report could not be sent.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="community-report" aria-labelledby="community-report-heading">
      <div className="section-intro">
        <p className="eyebrow">Community evidence</p>
        <h2 id="community-report-heading">Spot something RAR should review?</h2>
        <p className="section-copy">Send the original listing or source. Reports are reviewed by RAR before any catalogue record or market value changes.</p>
      </div>
      <button className="community-report-toggle" type="button" aria-expanded={isOpen} aria-controls="community-report-form" onClick={() => setIsOpen(!isOpen)}>{isOpen ? "Close report form" : "Report a sale or issue"}</button>
      {!isOpen ? <p className="community-report-note">A report creates a review item only. It never changes an edition or price automatically.</p> : null}
      {isOpen ? <form id="community-report-form" className="community-report-form" onSubmit={submit}>
        <p className="community-report-edition">Reporting on <strong>{editionTitle}</strong></p>
        <label>What did you find?
          <select value={reportType} onChange={(event) => setReportType(event.target.value as ReportType)}>
            <option value="sale">A completed sale</option>
            <option value="pricing_issue">A pricing issue</option>
            <option value="edition_issue">An edition-record issue</option>
          </select>
        </label>
        <label>Original source URL
          <input type="url" required value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…" />
        </label>
        <label>Listing or page title <span>(optional)</span>
          <input value={listingTitle} onChange={(event) => setListingTitle(event.target.value)} maxLength={400} placeholder="Copy the source title" />
        </label>
        <div className="community-report-sale-fields">
          <label>Reported price <span>(optional)</span>
            <input inputMode="decimal" value={reportedPrice} onChange={(event) => setReportedPrice(event.target.value)} placeholder="120.00" />
          </label>
          <label>Currency <span>(optional)</span>
            <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={3} placeholder="USD" />
          </label>
          <label>Sale date <span>(optional)</span>
            <input type="date" value={soldDate} onChange={(event) => setSoldDate(event.target.value)} />
          </label>
        </div>
        <label>Why should RAR review it?
          <textarea required minLength={20} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Tell us what the source shows, and why it matters for this exact edition." />
        </label>
        <label className="report-honeypot" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
        <div className="community-report-actions"><button disabled={saving} type="submit">{saving ? "Sending…" : "Send for review"}</button>{message ? <p role="status">{message}</p> : null}</div>
      </form> : null}
    </section>
  );
}
