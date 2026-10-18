// Same-origin copies of the verified catalogue covers in the gallery study.
// This is a fixed allowlist, not a general-purpose image proxy.
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
} as const;

export async function GET(request: Request) {
  const book = new URL(request.url).searchParams.get("book") || "one-piece";
  if (!(book in VERIFIED_COVERS)) return new Response("Cover not found", { status: 404 });
  const coverUrl = VERIFIED_COVERS[book as keyof typeof VERIFIED_COVERS];
  try {
    const upstream = await fetch(coverUrl, { signal: AbortSignal.timeout(12000), next: { revalidate: 86400 } });
    if (!upstream.ok) {
      return new Response("Cover unavailable", { status: 502 });
    }
    const image = await upstream.arrayBuffer();
    const bytes = new Uint8Array(image);
    // Some vetted publishers omit Content-Type despite returning a valid JPEG.
    if (bytes.length > 2_000_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      return new Response("Invalid cover", { status: 502 });
    }
    return new Response(image, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600, s-maxage=86400" } });
  } catch {
    return new Response("Cover unavailable", { status: 502 });
  }
}
