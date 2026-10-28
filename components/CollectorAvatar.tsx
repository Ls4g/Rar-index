"use client";

import { useState } from "react";

export default function CollectorAvatar({ name, url, className = "" }: { name: string; url: string | null; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(url && failedUrl !== url);
  return <span className={`collector-avatar ${className}`} aria-label={`${name}'s profile picture`}>
    {showImage ? /* eslint-disable-next-line @next/next/no-img-element */
      <img src={url!} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} />
      : <span aria-hidden="true">{name[0]?.toUpperCase() || "R"}</span>}
  </span>;
}
