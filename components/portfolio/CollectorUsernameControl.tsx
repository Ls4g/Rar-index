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
  const [shelfPublic, setShelfPublic] = useState(false);
  const [shelfSaving, setShelfSaving] = useState(false);
  const [shelfMessage, setShelfMessage] = useState("");
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
      .select("username,shelf_is_public")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const row = data as { username: string; shelf_is_public: boolean } | null;
        setUsername(row?.username ?? null);
        setShelfPublic(Boolean(row?.shelf_is_public));
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

  async function toggleShelf(next: boolean) {
    setShelfSaving(true);
    setShelfMessage("");
    const { error } = await supabase
      .from("collector_profiles")
      .update({ shelf_is_public: next, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (error) {
      setShelfMessage("Could not change that right now.");
    } else {
      setShelfPublic(next);
      setShelfMessage(next ? "Your shelf is public." : "Your shelf is private again.");
    }
    setShelfSaving(false);
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
          <p className="collector-handle-note">Your public collector handle. Your shelf lives at <code>/collectors/{draft.trim() || username || "handle"}</code> once you publish it below.</p>
          <div className="collector-handle-actions">
            <button disabled={disableSubmit} type="submit">{saving ? "Saving…" : "Save"}</button>
            <button className="portfolio-text-button" onClick={() => setEditing(false)} type="button">Cancel</button>
          </div>

          {/* Publishing is a separate, explicit act from claiming a handle,
              and the copy has to say exactly what becomes visible. What is
              shared is which editions you own -- never a price, a date, a
              note or a quantity, none of which the public view can even
              select. */}
          {username ? (
            <div className="collector-shelf-visibility">
              <label>
                <input
                  checked={shelfPublic}
                  disabled={shelfSaving}
                  onChange={(event) => void toggleShelf(event.target.checked)}
                  type="checkbox"
                />
                <span>Publish my shelf at <code>/collectors/{username}</code></span>
              </label>
              <p>
                Anyone with the link sees <strong>which editions you own</strong>. They never see what you paid, when you bought it, your notes, or how many copies you have.
              </p>
              {shelfMessage ? <small className={shelfMessage.startsWith("Could not") ? "collector-handle-status is-negative" : "collector-handle-status is-positive"}>{shelfMessage}</small> : null}
              {shelfPublic ? <a href={`/collectors/${username}`} rel="noreferrer" target="_blank">View your shelf ↗</a> : null}
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
