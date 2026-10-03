// Open Library's book-record API sometimes omits `cover` even when the Covers
// API has an image for the same ISBN. Only probe that second endpoint for an
// exact-ISBN book record, and never interpret its default blank image as art.
export function directOpenLibraryCoverUrl(isbn: string) {
  return `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg?default=false`;
}

export async function findDirectOpenLibraryCover(
  isbn: string,
  request: typeof fetch = fetch,
): Promise<string | null> {
  const url = directOpenLibraryCoverUrl(isbn);
  const response = await request(url, { method: "HEAD", cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Open Library Covers returned ${response.status}`);
  return url;
}
