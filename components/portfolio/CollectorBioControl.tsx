"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

const MAX_BIO_LENGTH = 160;

export default function CollectorBioControl({ userId, initialBio }: { userId: string; initialBio: string | null }) {
  const [bio, setBio] = useState(initialBio ?? "");
  const [savedBio, setSavedBio] = useState(initialBio ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    if (saving) return;
    const next = bio.trim();
    setSaving(true);
    setMessage("");
    const { error } = await supabase.from("collector_profiles")
      .update({ bio: next || null }).eq("user_id", userId);
    if (error) setMessage("Could not save your bio. Please try again.");
    else {
      setSavedBio(next);
      setMessage(next ? "Bio saved. It appears on your public profile." : "Bio removed.");
    }
    setSaving(false);
  }

  return <div className="collector-bio-control">
    <label htmlFor="collector-profile-bio"><strong>About you</strong><span>A short introduction beside your picture. Your bio is public, even if your shelf is private.</span></label>
    <textarea id="collector-profile-bio" rows={3} maxLength={MAX_BIO_LENGTH} value={bio} disabled={saving}
      placeholder="What do you love collecting?" onChange={(event) => { setBio(event.target.value); setMessage(""); }} />
    <div className="collector-bio-footer"><span>{bio.length} / {MAX_BIO_LENGTH}</span>
      <button type="button" disabled={saving || bio.trim() === savedBio} onClick={() => void save()}>{saving ? "Saving…" : "Save bio"}</button></div>
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
