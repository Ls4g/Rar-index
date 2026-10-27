/**
 * OpenBD exposes bibliographic data as JSON, which is useful for the import
 * audit but not for a human trying to inspect the physical book. Keep its
 * original URL as evidence and offer a separate ISBN-specific visual lookup.
 * This link never supplies a verified RAR cover or changes the source record.
 */
export function openBdVisualReference(sourceName: string | null, isbn13: string | null) {
  if (sourceName !== "OpenBD" || !isbn13 || !/^97[89]\d{10}$/.test(isbn13)) return null;
  return {
    url: `https://www.kinokuniya.co.jp/f/dsg-01-${isbn13}`,
    label: "View ISBN-matched book",
  };
}
