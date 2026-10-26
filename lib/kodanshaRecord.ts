export type KodanshaRecord = {
  sourceName: "Kodansha Japan" | "Kodansha USA";
  url: string;
  title: string;
  printIsbn13: string;
  coverUrl: string | null;
  language: "Japanese" | "English";
};

function decode(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#(?:39|x27);/gi, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

function meta(html: string, key: string) {
  const tag = html.match(new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${key}["'])[^>]*>`, "i"))?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "") : "";
}

function textOnly(html: string) {
  return decode(html.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function validIsbn13(value: string) {
  return /^97[89]\d{10}$/.test(value)
    && [...value].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10 === 0;
}

export function canonicalKodanshaProductUrl(rawUrl: string): string | null {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (url.hostname === "kc.kodansha.co.jp" && url.pathname === "/product") {
    const item = url.searchParams.get("item");
    return item && /^\d{10}$/.test(item) ? `https://www.kodansha.co.jp/comic/products/${item}` : null;
  }
  if (url.hostname === "www.kodansha.co.jp" && /^\/(?:comic|book)\/products\/\d+\/?$/.test(url.pathname)) return url.toString();
  if ((url.hostname === "kodansha.us" || url.hostname === "archive.kodansha.us")
    && (/^\/(?:book|series)\//.test(url.pathname) || /^\/volume\//.test(url.pathname))) return url.toString();
  return null;
}

export function kodanshaRecordKind(rawUrl: string): KodanshaRecord["sourceName"] | null {
  const canonical = canonicalKodanshaProductUrl(rawUrl);
  if (!canonical) return null;
  return new URL(canonical).hostname === "www.kodansha.co.jp" ? "Kodansha Japan" : "Kodansha USA";
}

export function parseKodanshaRecord(html: string, rawUrl: string): KodanshaRecord | null {
  const sourceName = kodanshaRecordKind(rawUrl);
  if (!sourceName) return null;
  const readable = textOnly(html);
  const ogTitle = meta(html, "og:title");
  const title = sourceName === "Kodansha Japan"
    ? ogTitle.match(/『([^』]+)』/)?.[1] ?? ""
    : ogTitle.split(/\s*[|–—]\s*/)[0]?.trim() ?? "";
  // A US page can list a digital ISBN before the print ISBN. Never use the
  // first generic ISBN on the page as the physical edition identifier.
  const printIsbn13 = sourceName === "Kodansha Japan"
    ? meta(html, "books:isbn").replace(/\D/g, "") || readable.match(/紙版[\s\S]{0,160}?ISBN\s*(97[89]\d{10})/)?.[1] || ""
    : readable.match(/Print\s+ISBN\s*:?\s*(97[89]\d{10})/i)?.[1] || "";
  if (!title || !validIsbn13(printIsbn13)) return null;
  const cover = meta(html, "og:image");
  let coverUrl: string | null = null;
  try {
    const parsed = new URL(cover);
    if (parsed.protocol === "https:" && (
      parsed.hostname === "dvs-cover.kodansha.co.jp"
      || parsed.hostname === "production.image.azuki.co"
      || parsed.hostname === "kodansha.us"
    )) coverUrl = parsed.toString();
  } catch { /* No official cover in this record. */ }
  return {
    sourceName, url: rawUrl, title, printIsbn13, coverUrl,
    language: sourceName === "Kodansha Japan" ? "Japanese" : "English",
  };
}

export async function fetchKodanshaRecord(rawUrl: string): Promise<KodanshaRecord | null> {
  const url = canonicalKodanshaProductUrl(rawUrl);
  if (!url) throw new Error("Not an approved Kodansha product URL.");
  return parseKodanshaRecord(await fetchKodanshaHtml(url), url);
}

async function fetchKodanshaHtml(rawUrl: string) {
  if (!kodanshaRecordKind(rawUrl)) throw new Error("Not an approved Kodansha product URL.");
  const response = await fetch(rawUrl, {
    headers: { Accept: "text/html", "User-Agent": "RAR-Index catalogue curator" },
    signal: AbortSignal.timeout(15_000), cache: "no-store", redirect: "error",
  });
  if (!response.ok) throw new Error(`Kodansha returned HTTP ${response.status}.`);
  return response.text();
}

export function kodanshaAdjacentUrl(html: string, direction: "next" | "previous"): string | null {
  const label = direction === "next" ? "次巻" : "前巻";
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (!textOnly(match[2]).includes(label)) continue;
    if (kodanshaRecordKind(match[1]) === "Kodansha Japan") return match[1];
  }
  return null;
}

export async function fetchKodanshaAdjacentRecord(seedUrl: string, direction: "next" | "previous") {
  if (kodanshaRecordKind(seedUrl) !== "Kodansha Japan") throw new Error("A Japanese Kodansha product URL is required.");
  const html = await fetchKodanshaHtml(canonicalKodanshaProductUrl(seedUrl)!);
  const nextUrl = kodanshaAdjacentUrl(html, direction);
  return nextUrl ? fetchKodanshaRecord(nextUrl) : null;
}
