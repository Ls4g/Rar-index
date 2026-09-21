"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStaffReviewer } from "@/lib/useStaffReviewer";

type AgentRun = { status?: string; summary?: string | null };

export default function CatalogueCuratorRunButton() {
  const router = useRouter();
  const [reviewer, setReviewer] = useStaffReviewer();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function runCurator() {
    if (!reviewer.trim()) {
      setMessage("Add your name or initials once, then run the Curator.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "run_agent", agentKey: "catalogue_curator", reviewer: reviewer.trim() }),
      });
      const result = await response.json() as { error?: string; run?: AgentRun };
      if (!response.ok) {
        setMessage(result.error ?? "The Catalogue Curator could not run.");
        return;
      }
      setMessage(result.run?.summary ?? (result.run?.status === "blocked" ? "The Curator needs attention before it can run." : "Catalogue search finished."));
      router.refresh();
    } catch {
      setMessage("The Catalogue Curator could not run. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="catalogue-curator-run">
      {!reviewer.trim() ? <label><span>Reviewer</span><input onChange={(event) => setReviewer(event.target.value)} placeholder="Name or initials" value={reviewer} /></label> : null}
      <button disabled={busy} onClick={() => void runCurator()} type="button">{busy ? "Searching…" : "Find next candidates"}</button>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
