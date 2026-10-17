// Same-origin copy of the already verified publisher cover for this one-book exhibit.
// The upstream URL is fixed: this is not a general image proxy.
const VERIFIED_COVER = "https://dw9to29mmj727.cloudfront.net/products/1569319014.jpg";

export async function GET() {
  try {
    const upstream = await fetch(VERIFIED_COVER, { signal: AbortSignal.timeout(6000), next: { revalidate: 86400 } });
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
