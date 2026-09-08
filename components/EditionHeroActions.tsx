"use client";

import Link from "next/link";
import { useState } from "react";

export default function EditionHeroActions({ editionId, title }: { editionId: string; title: string }) {
  const [shared, setShared] = useState(false);

  async function shareEdition() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${title} · RAR Index`, url });
      } else {
        await navigator.clipboard.writeText(url);
        setShared(true);
        window.setTimeout(() => setShared(false), 1800);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }

  return (
    <div className="edition-hero-actions">
      <Link className="home-btn" href={`/portfolio?edition=${editionId}`}>Add to collection <span>→</span></Link>
      <Link className="home-btn is-quiet" href={`/portfolio?edition=${editionId}`}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3.5 5.5c2.8-1.2 5.7-.7 8.5 1.5v13c-2.8-2.2-5.7-2.7-8.5-1.5v-13Zm17 0c-2.8-1.2-5.7-.7-8.5 1.5v13c2.8-2.2 5.7-2.7 8.5-1.5v-13Z" /></svg>
        Mark as read
      </Link>
      <button className="home-btn is-quiet" onClick={shareEdition} type="button">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12m0-12 4 4m-4-4L8 7M6 11H4.5A1.5 1.5 0 0 0 3 12.5v7A1.5 1.5 0 0 0 4.5 21h15a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H18" /></svg>
        {shared ? "Link copied" : "Share"}
      </button>
    </div>
  );
}
