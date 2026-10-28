"use client";

import { useState, type ChangeEvent } from "react";
import CollectorAvatar from "@/components/CollectorAvatar";
import { COLLECTOR_AVATAR_BUCKET, collectorAvatarPath, collectorAvatarUrl } from "@/lib/collectorAvatar";
import { supabase } from "@/lib/supabase";

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

async function squareJpeg(file: File): Promise<Blob> {
  const source = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion is unavailable.");
    context.fillStyle = "#f5f5f5";
    context.fillRect(0, 0, 512, 512);
    const side = Math.min(source.width, source.height);
    context.drawImage(source, (source.width - side) / 2, (source.height - side) / 2, side, side, 0, 0, 512, 512);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .85));
    if (!blob || blob.size > 1048576) throw new Error("Could not prepare a small profile photo.");
    return blob;
  } finally {
    source.close();
  }
}

export default function CollectorAvatarControl({ userId, username, initialUpdatedAt }: { userId: string; username: string; initialUpdatedAt: string | null }) {
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const imageUrl = collectorAvatarUrl(userId, updatedAt);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > MAX_SOURCE_BYTES) {
      setMessage("Choose a JPG, PNG or WebP image under 8 MB.");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const image = await squareJpeg(file);
      const { error: uploadError } = await supabase.storage.from(COLLECTOR_AVATAR_BUCKET)
        .upload(collectorAvatarPath(userId), image, { contentType: "image/jpeg", cacheControl: "60", upsert: true });
      if (uploadError) throw uploadError;
      const next = new Date().toISOString();
      const { error: profileError } = await supabase.from("collector_profiles")
        .update({ avatar_updated_at: next }).eq("user_id", userId);
      if (profileError) throw profileError;
      setUpdatedAt(next);
      setMessage("Profile picture saved. It appears wherever your public gallery is shown.");
    } catch {
      setMessage("Could not save your picture. Please try another image.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!updatedAt || busy) return;
    setBusy(true); setMessage("");
    const { error: removeError } = await supabase.storage.from(COLLECTOR_AVATAR_BUCKET).remove([collectorAvatarPath(userId)]);
    if (removeError) setMessage("Could not remove your picture. Please try again.");
    else {
      const { error: profileError } = await supabase.from("collector_profiles")
        .update({ avatar_updated_at: null }).eq("user_id", userId);
      if (profileError) setMessage("Picture removed, but the profile did not refresh. Please try again.");
      else { setUpdatedAt(null); setMessage("Profile picture removed."); }
    }
    setBusy(false);
  }

  return <div className="collector-avatar-control">
    <CollectorAvatar name={username} url={imageUrl} />
    <div><strong>Profile picture</strong><p>A square crop will appear on your gallery and collector card. This picture is public, even if your shelf is private.</p>
      <div className="collector-avatar-actions"><label className="collector-avatar-upload">{busy ? "Saving…" : updatedAt ? "Change picture" : "Add picture"}<input aria-label="Choose a profile picture" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => void upload(event)} type="file" /></label>
        {updatedAt ? <button disabled={busy} onClick={() => void remove()} type="button">Remove picture</button> : null}</div>
      {message ? <p role="status">{message}</p> : null}
    </div>
  </div>;
}
