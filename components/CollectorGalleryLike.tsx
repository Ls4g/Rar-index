"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function CollectorGalleryLike({ profileUserId, initialCount }: { profileUserId: string; initialCount: number }) {
  const [memberId, setMemberId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getUser().then(async ({ data }) => {
      const id = data.user?.id ?? null;
      if (!mounted) return;
      setMemberId(id);
      if (id) {
        const { data: like } = await supabase.from("collector_gallery_likes")
          .select("profile_user_id").eq("profile_user_id", profileUserId).eq("member_user_id", id).maybeSingle();
        if (mounted) setLiked(Boolean(like));
      }
      if (mounted) setReady(true);
    });
    return () => { mounted = false; };
  }, [profileUserId]);

  async function toggle() {
    if (!memberId || busy) return;
    setBusy(true); setError("");
    const result = liked
      ? await supabase.from("collector_gallery_likes").delete().eq("profile_user_id", profileUserId).eq("member_user_id", memberId)
      : await supabase.from("collector_gallery_likes").insert({ profile_user_id: profileUserId, member_user_id: memberId });
    if (result.error) setError("Could not update your like. Please try again.");
    else { setLiked(!liked); setCount((value) => Math.max(0, value + (liked ? -1 : 1))); }
    setBusy(false);
  }

  return <div>
    <button className="collector-gallery-like" type="button" aria-pressed={liked} disabled={!ready || !memberId || memberId === profileUserId || busy} onClick={() => void toggle()}>
      <span aria-hidden="true">{liked ? "♥" : "♡"}</span> {count} {count === 1 ? "like" : "likes"}
    </button>
    {ready && !memberId ? <span className="collector-gallery-like-status"><Link href="/portfolio">Sign in</Link> to like this gallery.</span> : null}
    {ready && memberId === profileUserId ? <span className="collector-gallery-like-status">This is your gallery.</span> : null}
    {error ? <span className="collector-gallery-like-status" role="alert">{error}</span> : null}
  </div>;
}
