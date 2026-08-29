"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type BatchResult = {
  scannedProfiles?: number;
  activeLeads?: number;
  failures?: number;
  discoveryProfiles?: number;
  maintenanceProfiles?: number;
  error?: string;
};

export default function ScoutBatchRunButton({ limit = 20 }: { limit?: number }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  async function scanBatch() {
    setWorking(true);
    setMessage("");
    try {
      const response = await fetch("/api/scout/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit }),
      });
      const result = await response.json() as BatchResult;
      if (!response.ok) throw new Error(result.error ?? "Scout could not run the batch.");

      const scanned = result.scannedProfiles ?? 0;
      const leads = result.activeLeads ?? 0;
      const failures = result.failures ?? 0;
      const discovery = result.discoveryProfiles ?? 0;
      const maintenance = result.maintenanceProfiles ?? 0;
      const failureText = failures ? "; " + failures + " failed" : "";
      setMessage(scanned + " profiles checked (" + discovery + " needing coverage, " + maintenance + " maintenance); " + leads + " active leads found" + failureText + ".");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Scout could not run the batch.");
    } finally {
      setWorking(false);
    }
  }

  return <div className="community-report-actions">
    <button type="button" disabled={working} onClick={scanBatch}>
      {working ? "Scanning " + limit + " profiles…" : "Scan next " + limit + " profiles"}
    </button>
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
