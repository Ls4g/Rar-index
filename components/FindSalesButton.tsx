"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The action half of the price-coverage page.
//
// Reporting that an edition has no price is only useful next to a way to go
// and get one. This runs one sold-listing search for the edition's ISBN and
// queues the listings worth looking at.
//
// It spends money on a metered account, so the button disables itself for the
// duration rather than letting an impatient second click start a second run.
// The server also refuses a repeat search for the same edition within its
// cooldown, because a disabled button is a courtesy and not a guarantee.

type FindSalesResponse = {
  ok?: true;
  error?: string;
  summary?: string;
  found?: number;
  queued?: number;
  needsHuman?: number;
  dropped?: number;
  alreadyKnown?: number;
  remainingUsd?: number;
};

export default function FindSalesButton({ editionId, label = "Find sales" }: { editionId: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function run() {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch("/api/price-coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "find-sales", editionId }),
      });
      const data = (await response.json().catch(() => ({}))) as FindSalesResponse;
      if (!response.ok || data.error) {
        setFailed(true);
        setMessage(data.error ?? "The search did not run.");
        return;
      }
      const parts = [data.summary ?? ""];
      if (data.dropped) parts.push(`${data.dropped} dropped as lots or unusable prices.`);
      if (data.needsHuman) parts.push(`${data.needsHuman} could not be pinned to one printing.`);
      if (data.alreadyKnown) parts.push(`${data.alreadyKnown} already known.`);
      if (typeof data.remainingUsd === "number") parts.push(`$${data.remainingUsd.toFixed(2)} credit left.`);
      setMessage(parts.filter(Boolean).join(" "));
      // The queued listings and this edition's counts are both server-rendered,
      // so the page has to be refetched for them to appear.
      if (data.queued) router.refresh();
    } catch {
      setFailed(true);
      setMessage("The search could not be reached. Nothing was queued.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="find-sales">
      <button className="find-sales-button" disabled={busy} onClick={() => void run()} type="button">
        {busy ? "Searching eBay…" : label}
      </button>
      {message ? (
        <span className={`find-sales-message${failed ? " is-error" : ""}`} role="status">{message}</span>
      ) : null}
    </span>
  );
}
