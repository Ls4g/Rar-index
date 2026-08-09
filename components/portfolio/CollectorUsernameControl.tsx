"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { normalizeUsername, validateUsernameFormat } from "@/lib/username";

type Status = "idle" | "checking" | "available" | "blocked";

type CollectorUsernameControlProps = {
  userId: string;
};

// Foundation-only: claims/edits the row in collector_profiles (see
// supabase/migrations/20260811_collector_usernames.sql). No public profile
// page reads this yet -- claiming a handle here only reserves it for when
// one exists. Never touches portfolio_holdings, price_observations, or
// anything else about the account.
export default function CollectorUsernameControl({ userId }: CollectorUsernameControlProps) {
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    supabase
      .from("collector_profiles")
      .select("username")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setUsername((data as { username: string } | null)?.username ?? null);
        setLoading(false);
      });
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    if (!editing) return;
    const trimmed = draft.trim();
    if (!trimmed) { queueMicrotask(() => { setStatus("idle"); setMessage(""); }); return; }
    const formatError = validateUsernameFormat(trimmed);
    if (formatError) { queueMicrotask(() => { setStatus("blocked"); setMessage(formatError); }); return; }
    if (username && normalizeUsername(trimmed) === normalizeUsername(username)) { queueMicrotask(() => { setStatus("idle"); setMessage(""); }); return; }
    queueMicrotask(() => { setStatus("checking"); setMessage(""); });
    const key = normalizeUsername(trimmed);
    const timer = window.setTimeout(() => {
      supabase
        .from("collector_profiles")
        .select("user_id")
        .eq("username_key", key)
        .maybeSingle()
        .then(({ data }) => {
          if (data) { setStatus("blocked"); setMessage("That handle is already taken."); }
          else { setStatus("available"); setMessage(""); }
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draft, editing, username]);

  function startEditing() {
    setDraft(username ?? "");
    setStatus("idle");
    setMessage("");
    setEditing(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = draft.trim();
    const formatError = validateUsernameFormat(trimmed);
    if (formatError) { setStatus("blocked"); setMessage(formatError); return; }
    setSaving(true);
    setMessage("");
    const { error } = await supabase
      .from("collector_profiles")
      .upsert({ user_id: userId, username: trimmed, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) {
      setMessage(
        error.code === "23505" ? "That handle is already taken."
          : error.message.includes("reserved") ? "That handle is reserved and can't be used."
          : "Could not save that handle.",
      );
    } else {
      setUsername(trimmed);
      setEditing(false);
    }
    setSaving(false);
  }

  if (loading) return null;

  const disableSubmit = saving || status === "checking" || status === "blocked" || !draft.trim();

  return (
    <div className="collector-handle">
      <button className="collector-handle-toggle" onClick={editing ? () => setEditing(false) : startEditing} type="button">
        {username ? `@${username}` : "Claim your collector handle"}
      </button>
      {editing ? (
        <form className="collector-handle-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="collector-handle-input">Collector handle</label>
          <div className="collector-handle-input-row">
            <span aria-hidden="true">@</span>
            <input autoFocus id="collector-handle-input" maxLength={20} onChange={(event) => setDraft(event.target.value)} value={draft} />
          </div>
          {status === "checking" ? <small className="collector-handle-status">Checking availability…</small> : null}
          {status === "available" ? <small className="collector-handle-status is-positive">Available</small> : null}
          {message ? <small className="collector-handle-status is-negative">{message}</small> : null}
          <p className="collector-handle-note">This is your public collector handle. A public collector page isn&apos;t live yet — claiming it now just reserves it for when one is.</p>
          <div className="collector-handle-actions">
            <button disabled={disableSubmit} type="submit">{saving ? "Saving…" : "Save"}</button>
            <button className="portfolio-text-button" onClick={() => setEditing(false)} type="button">Cancel</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
