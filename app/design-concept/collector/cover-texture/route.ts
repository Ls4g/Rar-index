// Same-origin copies of the three verified catalogue covers in the gallery.
// This is a fixed allowlist, not a general-purpose image proxy.
const VERIFIED_COVERS = {
  "one-piece": "https://dw9to29mmj727.cloudfront.net/products/1569319014.jpg",
  "dragon-ball": "https://covers.openlibrary.org/b/id/14859007-L.jpg",
  naruto: "https://dw9to29mmj727.cloudfront.net/products/1569319006.jpg",
} as const;

export async function GET(request: Request) {
  const book = new URL(request.url).searchParams.get("book") || "one-piece";
  if (!(book in VERIFIED_COVERS)) return new Response("Cover not found", { status: 404 });
  const coverUrl = VERIFIED_COVERS[book as keyof typeof VERIFIED_COVERS];
  try {
    const upstream = await fetch(coverUrl, { signal: AbortSignal.timeout(6000), next: { revalidate: 86400 } });
    if (!upstream.ok || upstream.headers.get("content-type")?.split(";")[0] !== "image/jpeg") {
      return new Response("Cover unavailable", { status: 502 });
    }
    const image = await upstream.arrayBuffer();
    if (image.byteLength > 2_000_000) return new Response("Cover too large", { status: 502 });
    return new Response(image, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600, s-maxage=86400" } });
  } catch {
    return new Response("Cover unavailable", { status: 502 });
  }
}
