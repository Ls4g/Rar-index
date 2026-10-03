"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PhotoResult = {
  checked?: number;
  attached?: number;
  alreadyFresh?: number;
  expiredWithoutReplacement?: number;
  graded?: number;
  noListingFound?: string[];
  errors?: string[];
  error?: string;
};

// Seller photos are short-lived issue-identification aids, not catalogue art.
export default function CataloguePhotoButton() {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  async function fetchPhotos() {
    setWorking(true);
    setMessage("");
    try {
      const response = await fetch("/api/catalogue-photos", { method: "POST" });
      const result = await response.json() as PhotoResult;
      if (!response.ok) throw new Error(result.error ?? "Photos could not be fetched.");
      const attached = result.attached ?? 0;
      const missed = result.noListingFound?.length ?? 0;
      const parts = [`${attached} photo${attached === 1 ? "" : "s"} attached`];
      if (result.alreadyFresh) parts.push(`${result.alreadyFresh} still current`);
      if (result.expiredWithoutReplacement) parts.push(`${result.expiredWithoutReplacement} old photo${result.expiredWithoutReplacement === 1 ? "" : "s"} with no current replacement (hidden publicly)`);
      // Worth saying out loud: a graded copy is a poorer look at the issue,
      // and those are only used when no loose copy was listed.
      if (result.graded) parts.push(`${result.graded} only available as a graded copy`);
      if (missed) parts.push(`${missed} with no matching listing`);
      if (result.errors?.length) parts.push(`${result.errors.length} error${result.errors.length === 1 ? "" : "s"}`);
      // The reasons matter more than the count: "nobody is selling one" and
      // "listings exist but none named the issue" need different responses,
      // and neither is visible from a number alone.
      const detail = result.errors?.length ? result.errors[0] : result.noListingFound?.[0];
      setMessage(`${parts.join(", ")}.${detail ? ` ${detail}` : ""}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Photos could not be fetched.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="community-report-actions catalogue-photo-action">
      <button type="button" disabled={working} onClick={fetchPhotos}>
        {working ? "Looking for copies…" : "Find photos of magazine issues"}
      </button>
      <p className="catalogue-photo-note">
        Checks active eBay listings for a photograph of the exact year and issue. A recently checked seller photo can appear in a separate eBay listing card, never as RAR’s catalogue cover. Old photos stop appearing publicly; staff can still verify an exact-issue image from a source with suitable reuse rights below.
      </p>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
