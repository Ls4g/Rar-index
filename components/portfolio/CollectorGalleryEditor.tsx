"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import { supabase } from "@/lib/supabase";
import { volumeSortValue } from "@/lib/seriesCompletion";
import type { Holding } from "./HoldingCard";

const MAX_WALL_BOOKS = 16;
type GalleryContent = { ids: string[]; title: string; caption: string; comments: Record<string, string> };

export default function CollectorGalleryEditor({ userId, holdings }: { userId: string; holdings: Holding[] }) {
  const eligible = useMemo(() => holdings.filter((holding) => holding.edition?.cover_verification_status === "verified" && holding.edition.cover_image_url)
    .sort((a, b) => (a.edition?.series ?? "").localeCompare(b.edition?.series ?? "") ||
      (volumeSortValue(a.edition?.volume_number ?? null) ?? 9999) - (volumeSortValue(b.edition?.volume_number ?? null) ?? 9999) || a.edition_id.localeCompare(b.edition_id)), [holdings]);
  const byId = useMemo(() => new Map(eligible.map((holding) => [holding.edition_id, holding])), [eligible]);
  const [ids, setIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [previous, setPrevious] = useState<string[] | null>(null);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [moving, setMoving] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [profile, setProfile] = useState<{ username: string; shelf_is_public: boolean } | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const latestSave = useRef(0);
  const latestContent = useRef<GalleryContent>({ ids: [], title: "", caption: "", comments: {} });
  const textSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      supabase.from("collector_gallery_layouts").select("edition_ids,title,caption,edition_comments").eq("user_id", userId).maybeSingle(),
      supabase.from("collector_profiles").select("username,shelf_is_public").eq("user_id", userId).maybeSingle(),
    ]).then(([layoutResult, profileResult]) => {
      if (!active) return;
      const saved = (layoutResult.data?.edition_ids ?? null) as string[] | null;
      const validIds = saved ? saved.filter((id) => byId.has(id)) : eligible.slice(0, MAX_WALL_BOOKS).map((holding) => holding.edition_id);
      const savedComments = layoutResult.data?.edition_comments;
      const validComments = Object.fromEntries(Object.entries(savedComments && typeof savedComments === "object" && !Array.isArray(savedComments) ? savedComments : {})
        .filter(([id, body]) => validIds.includes(id) && typeof body === "string")) as Record<string, string>;
      latestContent.current = { ids: validIds, title: layoutResult.data?.title ?? "", caption: layoutResult.data?.caption ?? "", comments: validComments };
      setIds(validIds);
      setTitle(latestContent.current.title);
      setCaption(latestContent.current.caption);
      setComments(validComments);
      setProfile(profileResult.data as { username: string; shelf_is_public: boolean } | null);
      if (layoutResult.error) setLoadFailed(true);
      setReady(true);
    });
    return () => {
      active = false;
      if (textSaveTimer.current) {
        clearTimeout(textSaveTimer.current);
        textSaveTimer.current = null;
        save(latestContent.current);
      }
    };
    // The initial layout is loaded once per signed-in user; a new holding
    // appears in the add list without rearranging a wall they already made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  function save(content: GalleryContent) {
    latestContent.current = content;
    setError("");
    setSaving(true);
    const saveNumber = ++latestSave.current;
    saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
      const { error: saveError } = await supabase.from("collector_gallery_layouts")
        .upsert({ user_id: userId, edition_ids: content.ids, title: content.title.trim(), caption: content.caption.trim(), edition_comments: content.comments }, { onConflict: "user_id" });
      if (saveNumber === latestSave.current) {
        setSaving(false);
        setError(saveError ? "Could not save your gallery. Refresh and try again." : "");
      }
    });
  }

  function changeText(next: GalleryContent) {
    latestContent.current = next;
    setTitle(next.title);
    setCaption(next.caption);
    setComments(next.comments);
    setSaving(true);
    if (textSaveTimer.current) clearTimeout(textSaveTimer.current);
    textSaveTimer.current = setTimeout(() => { textSaveTimer.current = null; save(latestContent.current); }, 650);
  }

  function flushText() {
    if (!textSaveTimer.current) return;
    clearTimeout(textSaveTimer.current);
    textSaveTimer.current = null;
    save(latestContent.current);
  }

  function arrange(next: string[]) {
    const before = ids;
    setPrevious(before);
    setIds(next);
    setMoving(null);
    if (textSaveTimer.current) { clearTimeout(textSaveTimer.current); textSaveTimer.current = null; }
    const nextComments = Object.fromEntries(Object.entries(latestContent.current.comments).filter(([id]) => next.includes(id)));
    setComments(nextComments);
    save({ ...latestContent.current, ids: next, comments: nextComments });
  }

  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return;
    const next = [...ids];
    [next[from], next[to]] = [next[to], next[from]];
    arrange(next);
  }

  const available = eligible.filter((holding) => !ids.includes(holding.edition_id) &&
    `${holding.edition?.series ?? ""} ${holding.edition?.title ?? ""} ${holding.edition?.volume_number ?? ""}`.toLowerCase().includes(search.toLowerCase()));

  return <details className="collector-gallery-editor" id="arrange-gallery">
    <summary><span><strong>Arrange your gallery wall</strong><small>Choose up to {MAX_WALL_BOOKS} covers and put them in your order.</small></span><span aria-hidden="true">↗</span></summary>
    <div className="collector-gallery-editor-body">
      <p>Drag covers to swap places, or tap one and then its destination. This changes only the display—not your collection.</p>
      {profile?.shelf_is_public ? <p className="collector-gallery-public-link"><Link href={`/collectors/${profile.username}#gallery`} target="_blank">View your live gallery ↗</Link></p>
        : <p className="collector-gallery-private">Your shelf is private. Publish it using the @handle control above when you want others to see it.</p>}
      {!profile && ready ? <p>Claim a collector handle above before arranging your display.</p> : null}
      {!ready ? <p>Loading your display…</p> : loadFailed ? <p role="alert">Could not load your gallery. Refresh before editing so your existing display is preserved.</p> : profile ? <>
        <div className="collector-gallery-copy-fields">
          <label htmlFor="collector-gallery-title">Gallery title <input id="collector-gallery-title" maxLength={80} value={title} onChange={(event) => changeText({ ...latestContent.current, title: event.target.value })} onBlur={flushText} placeholder={`${profile.username}'s gallery`} /></label>
          <label htmlFor="collector-gallery-caption">Caption <textarea id="collector-gallery-caption" maxLength={240} rows={2} value={caption} onChange={(event) => changeText({ ...latestContent.current, caption: event.target.value })} onBlur={flushText} placeholder="Tell visitors about your collection…" /></label>
          <small>Your title, caption and book comments appear to visitors when your shelf is public. Saved automatically.</small>
        </div>
        <div className="collector-gallery-wall" aria-label="Your gallery display order">
          {ids.map((id, index) => {
            const holding = byId.get(id);
            return <div className={`collector-gallery-slot${moving === index ? " is-moving" : ""}`} key={id}
              draggable={Boolean(holding)} onDragStart={() => setDragging(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); if (dragging !== null) move(dragging, index); setDragging(null); }}
              onDragEnd={() => setDragging(null)}>
              <button type="button" className="collector-gallery-cover" onClick={() => { if (moving === null) setMoving(index); else move(moving, index); }}
                aria-label={`${moving === null ? "Move" : "Place here"} ${holding?.edition?.title ?? "edition"}, position ${index + 1}`}>
                {holding?.edition ? <EditionCover title={holding.edition.title} series={holding.edition.series} volumeNumber={holding.edition.volume_number}
                  language={holding.edition.language} imageUrl={holding.edition.cover_image_url} imageStatus={holding.edition.cover_verification_status} /> : <span>Cover unavailable</span>}
              </button>
              <div className="collector-gallery-slot-label"><span>{String(index + 1).padStart(2, "0")} · {holding?.edition?.series ?? "Edition removed"} {holding?.edition?.volume_number ? `Vol. ${holding.edition.volume_number}` : ""}</span>
                <button type="button" onClick={() => arrange(ids.filter((item) => item !== id))} aria-label={`Remove ${holding?.edition?.title ?? "edition"} from wall`}>Remove</button></div>
              <label className="collector-gallery-comment">Your note about this edition<textarea rows={2} maxLength={280} value={comments[id] ?? ""} placeholder="This is my favourite manga!" onBlur={flushText} onChange={(event) => {
                const nextComments = { ...latestContent.current.comments };
                if (event.target.value.trim()) nextComments[id] = event.target.value;
                else delete nextComments[id];
                changeText({ ...latestContent.current, comments: nextComments });
              }} /></label>
            </div>;
          })}
        </div>
        {moving !== null ? <p className="collector-gallery-move-hint">Now tap the place you want this book. <button type="button" onClick={() => setMoving(null)}>Cancel move</button></p> : null}
        <div className="collector-gallery-toolbar"><span>{ids.length} / {MAX_WALL_BOOKS} on display</span><button type="button" disabled={!previous} onClick={() => { if (previous) { const restore = previous; arrange(restore); setPrevious(null); } }}>Undo last change</button><span role="status">{error || (saving ? "Saving…" : "Saved automatically")}</span></div>
        {ids.length < MAX_WALL_BOOKS && eligible.length > ids.length ? <div className="collector-gallery-add"><label htmlFor="collector-gallery-search">Add an edition you own</label>
          <input id="collector-gallery-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your editions" />
          <div className="collector-gallery-add-list">{available.slice(0, 30).map((holding) => <button type="button" key={holding.edition_id} onClick={() => arrange([...ids, holding.edition_id])}>
            <span>{holding.edition?.series || holding.edition?.title} {holding.edition?.volume_number ? `· Vol. ${holding.edition.volume_number}` : ""}</span><span>+ Add</span>
          </button>)}</div>
        </div> : null}
        {!eligible.length ? <p>Once an edition you own has a verified cover, you can display it here.</p> : null}
      </> : null}
    </div>
  </details>;
}
