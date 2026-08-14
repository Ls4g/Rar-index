"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PhotoResult = {
  checked?: number;
  attached?: number;
  graded?: number;
  noListingFound?: string[];
  errors?: string[];
  error?: string;
};

// A magazine issue has no cover picture in any catalogue source -- the art is
// copyrighted -- so the only way to see one is a photo of a copy on sale.
// This fetches those. It exists as a button rather than an endpoint to call
// by hand because the reviewer works on a phone, where there is no console.
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
      // Worth saying out loud: a graded copy is a poorer look at the issue,
      // and those are only used when no loose copy was listed.
      if (result.graded) parts.push(`${result.graded} only available as a graded copy`);
      if (missed) parts.push(`${missed} with no matching listing`);
      if (result.errors?.length) parts.push(`${result.errors.length} error${result.errors.length === 1 ? "" : "s"}`);
      setMessage(`${parts.join(", ")}.${result.errors?.length ? ` First: ${result.errors[0]}` : ""}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Photos could not be fetched.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="community-report-actions">
      <button type="button" disabled={working} onClick={fetchPhotos}>
        {working ? "Looking for copies…" : "Find photos of these issues"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
