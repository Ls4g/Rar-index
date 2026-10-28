"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function GalleryReportDecision({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(decision: "hide" | "dismiss") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/gallery-comment-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportId, decision }) });
      if (!response.ok) throw new Error();
      router.refresh();
    } catch { setError("Could not save this decision."); }
    finally { setBusy(false); }
  }
  return <div><button disabled={busy} type="button" onClick={() => void decide("hide")}>Hide comment</button> <button disabled={busy} type="button" onClick={() => void decide("dismiss")}>Dismiss report</button>{error ? <p role="alert">{error}</p> : null}</div>;
}
