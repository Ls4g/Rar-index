import { isIP } from "node:net";
import { supabase } from "@/lib/supabase";

// Same-origin copies of verified catalogue covers for the WebGL gallery.
// The demo uses a fixed allowlist; real shelves resolve only approved edition
// records, never a caller-supplied remote URL.
const VERIFIED_COVERS = {
  "one-piece": "https://dw9to29mmj727.cloudfront.net/products/1569319014.jpg",
  "dragon-ball": "https://covers.openlibrary.org/b/id/14859007-L.jpg",
  naruto: "https://dw9to29mmj727.cloudfront.net/products/1569319006.jpg",
  berserk: "https://covers.openlibrary.org/b/id/14857363-L.jpg",
  "slam-dunk": "https://covers.openlibrary.org/b/id/12860018-L.jpg",
  bleach: "https://covers.openlibrary.org/b/id/2806276-L.jpg",
  "jujutsu-kaisen": "https://dw9to29mmj727.cloudfront.net/products/1974710025.jpg",
  "chainsaw-man": "https://covers.openlibrary.org/b/id/13222012-L.jpg",
  "attack-on-titan": "https://dvs-cover.kodansha.co.jp/0000017064/qLLMwJdlqPdbWsGu48rCYwKGmqTQevk4XcM1yTlp.jpg",
  "black-clover": "https://dw9to29mmj727.cloudfront.net/products/1421587181.jpg",
  kagurabachi: "https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088838199/500/9784088838199.jpg",
  "hunter-hunter": "https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088725710/500/9784088725710.jpg",
  "one-piece-2": "https://covers.openlibrary.org/b/id/13729742-M.jpg",
  "naruto-2": "https://dw9to29mmj727.cloudfront.net/products/1591161789.jpg",
  "naruto-3": "https://dw9to29mmj727.cloudfront.net/products/1591161878.jpg",
  "naruto-4": "https://covers.openlibrary.org/b/id/7234165-L.jpg",
} as const;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const editionId = params.get("editionId");
  let coverUrl: string;
  if (editionId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(editionId)) {
      return new Response("Cover not found", { status: 404 });
    }
    const { data, error } = await supabase.from("manga_editions")
      .select("cover_image_url")
      .eq("id", editionId)
      .eq("cover_verification_status", "verified")
      .maybeSingle();
    if (error || !data?.cover_image_url) return new Response("Cover not found", { status: 404 });
    coverUrl = data.cover_image_url;
  } else {
    const book = params.get("book") || "one-piece";
    if (!(book in VERIFIED_COVERS)) return new Response("Cover not found", { status: 404 });
    coverUrl = VERIFIED_COVERS[book as keyof typeof VERIFIED_COVERS];
  }

  try {
    let target = new URL(coverUrl);
    let upstream: Response | null = null;
    for (let hop = 0; hop < 3; hop++) {
      const host = target.hostname.toLowerCase();
      if (target.protocol !== "https:" || target.username || target.password || isIP(host) || host.includes(":")
        || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
        return new Response("Cover unavailable", { status: 502 });
      }
      upstream = await fetch(target, { signal: AbortSignal.timeout(12000), redirect: "manual", next: { revalidate: 86400 } });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      const location = upstream.headers.get("location");
      if (!location) return new Response("Cover unavailable", { status: 502 });
      target = new URL(location, target);
      upstream = null;
    }
    if (!upstream) return new Response("Cover unavailable", { status: 502 });
    if (!upstream.ok) {
      return new Response("Cover unavailable", { status: 502 });
    }
    const length = Number(upstream.headers.get("content-length"));
    if (length > 3_000_000) return new Response("Invalid cover", { status: 502 });
    const image = await upstream.arrayBuffer();
    const bytes = new Uint8Array(image);
    // Some vetted publishers omit Content-Type, so trust only image signatures.
    const type = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg"
      : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 ? "image/png"
        : String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP" ? "image/webp" : null;
    if (bytes.length > 3_000_000 || !type) return new Response("Invalid cover", { status: 502 });
    return new Response(image, { headers: { "content-type": type, "cache-control": "public, max-age=3600, s-maxage=86400" } });
  } catch {
    return new Response("Cover unavailable", { status: 502 });
  }
}
