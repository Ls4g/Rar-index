type EditionDisplayFields = {
  edition_statement?: string | null;
  printing_number?: number | null;
  variant_name?: string | null;
};

const publisherAliases: Array<[RegExp, string]> = [
  [/^viz media(?: llc)?$/i, "VIZ Media"],
  [/^kodansha(?: comics)?$/i, "Kodansha"],
  [/^dark horse(?: manga| comics)?$/i, "Dark Horse Comics"],
];

export function editionDescriptor(edition: EditionDisplayFields) {
  if (edition.variant_name) return edition.variant_name;
  if (edition.printing_number) return `${ordinal(edition.printing_number)} printing`;
  if (edition.edition_statement) return edition.edition_statement;
  return "Standard edition record";
}

function ordinal(value: number) {
  const finalTwo = value % 100;
  if (finalTwo >= 11 && finalTwo <= 13) return `${value}th`;
  const suffix = value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th";
  return `${value}${suffix}`;
}

export function publisherDisplayName(publisher: string | null | undefined) {
  if (!publisher) return "Publisher pending";
  return publisherAliases.find(([pattern]) => pattern.test(publisher))?.[1] ?? publisher;
}

// A single honest line for how documented an edition is, reused anywhere a
// catalogue card needs to say so in plain text rather than implying it.
export function evidenceStatusLabel(coverVerified: boolean, verifiedSaleCount: number) {
  const cover = coverVerified ? "Verified cover" : "Cover pending";
  const sale = verifiedSaleCount > 0 ? `${verifiedSaleCount} verified sale${verifiedSaleCount === 1 ? "" : "s"}` : "No verified sale yet";
  return `${sale} · ${cover}`;
}
