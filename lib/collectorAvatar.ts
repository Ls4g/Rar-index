import { supabase } from "@/lib/supabase";

export const COLLECTOR_AVATAR_BUCKET = "collector-avatars";

export function collectorAvatarPath(userId: string) {
  return `${userId}/avatar.jpg`;
}

export function collectorAvatarUrl(userId: string, updatedAt: string | null | undefined) {
  if (!updatedAt) return null;
  const { data } = supabase.storage.from(COLLECTOR_AVATAR_BUCKET).getPublicUrl(collectorAvatarPath(userId));
  return `${data.publicUrl}?v=${encodeURIComponent(updatedAt)}`;
}
