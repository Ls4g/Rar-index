"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  profileId: string;
  searchQuery: string;
  scopeNotes: string;
  collectionIntervalDays: number;
  isActive: boolean;
};

export default function CollectionProfileEditForm({ profileId, searchQuery: initialQuery, scopeNotes: initialScope, collectionIntervalDays: initialInterval, isActive: initialActive }: Props) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [scopeNotes, setScopeNotes] = useState(initialScope);
  const [interval, setInterval] = useState(String(initialInterval));
  const [isActive, setIsActive] = useState(initialActive);
  const [changedBy, setChangedBy] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/collection-profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, searchQuery, scopeNotes, collectionIntervalDays: Number(interval), isActive, changedBy, changeNote }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The profile could not be updated.");
      setChangeNote("");
      setMessage("Profile updated. Future collection runs will use the new query; the previous version is recorded below.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The profile could not be updated."); } finally { setSaving(false); }
  }

  return <details className="profile-editor">
    <summary><span>Edit this search profile</span><small>Query, boundary and cadence</small></summary>
    <form className="quick-sale-form profile-editor-form" onSubmit={submit}>
      <p className="profile-editor-note">The marketplace source is locked after creation so past collection runs keep their original meaning. Changes affect future checks only.</p>
      <div className="quick-sale-grid">
        <label className="quick-sale-wide">Exact marketplace query<input required value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></label>
        <label className="quick-sale-wide">Edition boundary note<textarea required minLength={20} value={scopeNotes} onChange={(event) => setScopeNotes(event.target.value)} rows={5} /></label>
        <label>Check every<select value={interval} onChange={(event) => setInterval(event.target.value)}><option value="1">Day</option><option value="7">Week</option><option value="14">Two weeks</option><option value="30">Month</option></select></label>
        <label className="profile-active-field">Profile state<span><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> Keep this profile active</span></label>
        <label>Updated by<input required value={changedBy} onChange={(event) => setChangedBy(event.target.value)} placeholder="Your name or initials" /></label>
        <label>Why this changed<input required minLength={8} value={changeNote} onChange={(event) => setChangeNote(event.target.value)} placeholder="For example: added manga and Vol. 1 terms" /></label>
      </div>
      <div className="quick-sale-submit"><button type="submit" disabled={saving}>{saving ? "Saving..." : "Save profile changes"}</button>{message ? <p role="status">{message}</p> : null}</div>
    </form>
  </details>;
}
