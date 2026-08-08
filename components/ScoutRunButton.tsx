"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ScoutRunButton({ profileId }: { profileId: string }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  async function scan() {
    setWorking(true);
    setMessage("");
    try {
      const response = await fetch("/api/scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      const result = await response.json() as { scanned?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Scout could not run.");
      setMessage(`${result.scanned ?? 0} active listing lead${result.scanned === 1 ? "" : "s"} recorded.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Scout could not run.");
    } finally {
      setWorking(false);
    }
  }

  return <div className="community-report-actions"><button type="button" disabled={working} onClick={scan}>{working ? "Scanning…" : "Run active scan"}</button>{message ? <p role="status">{message}</p> : null}</div>;
}
