// Listings eBay confirmed SOLD where only the accepted price is missing.
//
//   node --env-file=.env.local scripts/report-sold-price-unknown.mjs
//
// READ ONLY. It writes nothing and confirms nothing.
//
// These are not "we don't know what happened". eBay's Trading API reported
// the listing sold; it simply does not return the accepted amount on a Best
// Offer listing. So the sale is established and the price is not, which is a
// different thing from the ~1,700 rows beside them where nothing is known.
//
// The price is recoverable by a person: eBay prints the accepted Best Offer
// price on the original sold page, and `outcomeSaleFields` accepts that same
// page as the corroborating link (see b4caf01). So each row below is a real
// sale a human can finish in about a minute.
//
// They are reachable in the UI -- Sales, attention view, Best Offer queue --
// but undifferentiated: 47 established sales sitting among ~590 Best Offer
// rows where nothing is known. This lists only the established ones.
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Read every row, in pages. A capped query is not a total. */
async function readAll(table, columns, filter) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = admin.from(table).select(columns).order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

// The classification reason is stored on the row, so the selector is exact:
// measured at 47 matches and 0 false positives, where buying_format alone
// would have pulled in 588 unresolved Best Offer rows.
const sold = await readAll(
  "listing_outcomes",
  "id,external_id,listing_title,buying_format,source_listing_url,outcome_reason,check_attempts,edition_id,"
    + "edition:manga_editions(title,series,volume_number,language)",
  (query) => query
    .eq("status", "ambiguous")
    .is("reviewed_by", null)
    .is("resulting_observation_id", null)
    .ilike("outcome_reason", "%Best Offer%"),
);

const editions = new Set(sold.filter((row) => row.edition_id).map((row) => row.edition_id));
console.log(`Sold, accepted price not disclosed by eBay: ${sold.length}`);
console.log(`Distinct editions affected: ${editions.size}`);
console.log("");
console.log("Each of these is an established sale. eBay prints the accepted Best Offer");
console.log("price on the sold page, and the same page is accepted as the corroborating");
console.log("link, so the price can be read off and confirmed on /listing-outcomes.");
console.log("");

const label = (row) => {
  const edition = row.edition;
  if (!edition) return "(no edition on file)";
  return [edition.series ?? edition.title, edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language]
    .filter(Boolean).join(" · ");
};

const byEdition = new Map();
for (const row of sold) {
  const key = label(row);
  byEdition.set(key, [...(byEdition.get(key) ?? []), row]);
}

for (const [edition, rows] of [...byEdition.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${edition}  (${rows.length})`);
  for (const row of rows) {
    console.log(`   ${String(row.listing_title).slice(0, 62)}`);
    console.log(`   ${row.source_listing_url ?? "(no source url)"}`);
  }
  console.log("");
}

console.log("Nothing was written. Confirming any of these is a human decision.");
