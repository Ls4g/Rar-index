"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { PublicJourneyEvent } from "@/lib/publicJourney";

export function trackPublicJourney(event: PublicJourneyEvent) {
  if (typeof window === "undefined" || location.hostname === "localhost" || location.hostname === "127.0.0.1") return;
  void fetch("/api/public-journey", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }), keepalive: true, credentials: "same-origin",
  }).catch(() => {});
}

export default function PublicJourneyTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (/^\/edition\/[0-9a-f-]{36}$/i.test(pathname)) trackPublicJourney("edition_view");
  }, [pathname]);
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const anchor = (event.target as Element | null)?.closest?.("a[data-rar-listing-click]");
      if (anchor) trackPublicJourney("listing_click");
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
