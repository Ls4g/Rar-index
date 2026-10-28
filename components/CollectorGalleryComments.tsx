"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

type Comment = { id: string; author_user_id: string; body: string; created_at: string };

export default function CollectorGalleryComments({ profileUserId, enabled }: { profileUserId: string; enabled: boolean }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState("Spam");

  const load = useCallback(async () => {
    if (!enabled) return;
    const { data, error } = await supabase.from("collector_gallery_comments")
      .select("id,author_user_id,body,created_at")
      .eq("profile_user_id", profileUserId).eq("is_hidden", false)
      .order("created_at", { ascending: false }).limit(100);
    if (error) { setMessage("Comments could not load right now."); return; }
    const rows = (data ?? []) as Comment[];
    setComments(rows);
    const ids = [...new Set(rows.map((row) => row.author_user_id))];
    if (ids.length) {
      const { data: profiles } = await supabase.from("collector_profiles").select("user_id,username").in("user_id", ids);
      setNames(Object.fromEntries((profiles ?? []).map((profile) => [profile.user_id, profile.username])));
    }
  }, [enabled, profileUserId]);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || !body.trim() || busy) return;
    setBusy(true); setMessage("");
    const { error } = await supabase.from("collector_gallery_comments")
      .insert({ profile_user_id: profileUserId, author_user_id: userId, body: body.trim() });
    if (error) setMessage(error.message.includes("wait") ? "Please wait a little before commenting again." : "Could not post your comment. Please try again.");
    else { setBody(""); await load(); setMessage("Comment posted."); }
    setBusy(false);
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this comment?")) return;
    const { error } = await supabase.from("collector_gallery_comments").delete().eq("id", id);
    setMessage(error ? "Could not remove that comment." : "Comment removed.");
    if (!error) await load();
  }

  async function report(id: string) {
    if (!userId) return;
    const { error } = await supabase.from("collector_gallery_comment_reports")
      .insert({ comment_id: id, reporter_user_id: userId, reason });
    setMessage(error ? error.code === "23505" ? "You already reported this comment." : "Could not send this report." : "Report sent to RAR staff.");
    if (!error) setReporting(null);
  }

  return <section className="collector-gallery-conversation" aria-labelledby="gallery-conversation-heading">
    <div className="collector-gallery-conversation-head"><p className="rar-concept-kicker">THE CONVERSATION</p><h2 id="gallery-conversation-heading">Gallery comments<span>.</span></h2></div>
    {!enabled ? <p>This collector has comments turned off.</p> : <>
      {comments.length ? <ol className="collector-gallery-comment-list">{comments.map((comment) => <li key={comment.id}>
        <div><strong>{names[comment.author_user_id] ? `@${names[comment.author_user_id]}` : "RAR member"}</strong><time dateTime={comment.created_at}>{new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(comment.created_at))}</time></div>
        <p>{comment.body}</p>
        {userId && (userId === comment.author_user_id || userId === profileUserId) ? <button type="button" onClick={() => void remove(comment.id)}>Remove</button> : null}
        {userId && userId !== comment.author_user_id ? <button type="button" onClick={() => setReporting(reporting === comment.id ? null : comment.id)}>Report</button> : null}
        {reporting === comment.id ? <div className="collector-gallery-report"><label>Reason <select value={reason} onChange={(event) => setReason(event.target.value)}><option>Spam</option><option>Harassment</option><option>Other inappropriate content</option></select></label><button type="button" onClick={() => void report(comment.id)}>Send report</button></div> : null}
      </li>)}</ol> : <p>No comments yet. Start the conversation about this collection.</p>}
      {userId ? <form onSubmit={(event) => void submit(event)}><label htmlFor="gallery-comment-input">Leave a comment</label><textarea id="gallery-comment-input" maxLength={500} required rows={3} value={body} onChange={(event) => setBody(event.target.value)} placeholder="What caught your eye?" /><div><small>{body.length}/500</small><button disabled={busy || !body.trim()} type="submit">{busy ? "Posting…" : "Post comment"}</button></div></form> : <p><Link href="/portfolio">Sign in</Link> to leave a comment.</p>}
    </>}
    <p role="status" className="collector-gallery-comment-status">{message}</p>
  </section>;
}
