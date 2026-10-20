"use client";

import { useState } from "react";
import ScoutRunButton from "@/components/ScoutRunButton";

type Profile = {
  id: string;
  title: string;
  language: string | null;
  isbn: string | null;
  source: string | null;
  lastChecked: string;
};

export default function ScoutProfileScans({ profiles }: { profiles: Profile[] }) {
  const [open, setOpen] = useState(false);
  return <details className="profile-editor scout-profile-scan" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span>Scan one profile on demand</span><small>{profiles.length} active search profiles</small></summary>
    {open ? profiles.length ? <div className="review-list scout-profile-list">
      {profiles.map((profile) => <div className="scout-profile-row" key={profile.id}>
        <div>
          <strong>{profile.title}</strong>
          <small>{[profile.language, profile.isbn ? `ISBN ${profile.isbn}` : null, profile.source].filter(Boolean).join(" · ")} · {profile.lastChecked}</small>
        </div>
        <ScoutRunButton profileId={profile.id} />
      </div>)}
    </div> : <p>No active profiles yet. Create an exact-edition eBay profile before Scout can run.</p> : null}
  </details>;
}
