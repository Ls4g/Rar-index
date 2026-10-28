"use client";

import { useState } from "react";

export default function CollectorShareButton({ username }: { username: string }) {
  const [message, setMessage] = useState("");
  async function share() {
    const url = `${window.location.origin}/collectors/${encodeURIComponent(username)}`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Link copied");
    } catch { setMessage("Could not copy this link"); }
  }
  return <span className="collector-share-wrap"><button type="button" className="collector-share-button" onClick={() => void share()}>Copy gallery link ↗</button><span role="status">{message}</span></span>;
}
