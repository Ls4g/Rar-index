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
  alreadySearched?: boolean;
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
      // A search should end at the findings, not back on the edition list.
      // Navigate even when nothing new was queued: the workbench explains the
      // result and still exposes earlier unresolved findings for this edition.
      router.push(`/price-coverage?edition=${encodeURIComponent(editionId)}&searched=1&found=${data.found ?? 0}&queued=${data.queued ?? 0}&known=${data.alreadyKnown ?? 0}&excluded=${(data.dropped ?? 0) + (data.needsHuman ?? 0)}${data.alreadySearched ? "&recent=1" : ""}`);
    } catch {
      setFailed(true);
      setMessage("The search could not be reached. Nothing was queued.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="find-sales">
      <button className={`find-sales-button${label === "Find sales" ? " is-primary" : ""}`} disabled={busy} onClick={() => void run()} type="button">
        {busy ? "Searching eBay…" : label}
      </button>
      {message ? (
        <span className={`find-sales-message${failed ? " is-error" : ""}`} role="status">{message}</span>
      ) : null}
    </span>
  );
}
