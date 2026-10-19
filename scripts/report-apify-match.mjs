// What RAR would make of a batch of Apify eBay rows, before anything is written.
//
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/report-apify-match.mjs <apify-dataset-id | path/to/rows.json>
//
// READ ONLY. It writes nothing to RAR and nothing to Apify. It creates no
// evidence, confirms no sale and queues nothing.
//
// What this answers, and what it deliberately does not.
//
// Apify searches eBay's sold-listings index by ISBN and hands back rows. Two
// separate questions have to be answered about each row, and conflating them
// is how a wrong sale gets created:
//
//   1. Is this listing the edition we searched for?   <- this script
//   2. Did it actually sell, and for how much?        <- NOT this script
//
// Question 2 is not answerable from Apify. Its sold signal only echoes the
// search filter that produced the row: a listing eBay's sold index returned on
// 16 October was, on its own item page, ended by the seller because the item
// was no longer available, on that same date. So nothing here is treated as a
// sale. A row that survives this script is only a listing worth asking eBay
// about directly, via RAR's existing Trading GetItem check, which reads
// quantitySold on the item itself. That check is the evidence; Apify only
// narrows what it gets pointed at, which is the one thing AGENTS.md permits an
// automated source to do.
//
// Question 1 is answerable, because the catalogue already has a scorer for
// exactly this shape of problem: assessScoutListing, the same function Scout
// uses to decide whether a live listing is worth watching. Reusing it means a
// scoring change applies here too, and this script cannot drift into being a
// second, laxer opinion about what counts as a match.
//
// The ISBN is not an edition. 227 distinct ISBNs cover 230 editions: three
// ISBNs carry two editions each, because a later printing keeps the ISBN of
// the first. On those three, a listing that does not name its printing is
// genuinely undecidable from the title, and lands in "needs a human" rather
// than being assigned to whichever row the database happened to return first.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { assessScoutListing } from "../lib/scoutIngest.ts";
import { loadActiveScoutRules } from "../lib/scoutRules.ts";
import { normalizeIsbn } from "../lib/coverCandidateMatch.ts";

const EDITION_COLUMNS =
  "id,title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no";

const source = process.argv[2];
if (!source) {
  console.error("Usage: report-apify-match.mjs <apify-dataset-id | path/to/rows.json>");
  process.exit(1);
}

async function loadRows(ref) {
  if (ref.endsWith(".json")) return JSON.parse(readFileSync(ref, "utf8"));
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set; add it to .env.local");
  // Reading an existing dataset costs nothing. This never starts a run, so it
  // cannot spend credit by accident.
  const res = await fetch(`https://api.apify.com/v2/datasets/${ref}/items?clean=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Apify dataset read failed: HTTP ${res.status}`);
  return res.json();
}

// Reasons a row is unusable whichever edition it turns out to be. These are
// about whether a price could ever be trusted, not about matching.
function priceDisqualifier(row) {
  if (!row.itemId) return "no eBay item id, so RAR could never check it";
  if (row.isBestOfferAccepted === true) {
    return "Best Offer accepted; the search row does not disclose what was actually paid";
  }
  if (row.soldPriceMax != null) {
    return "a price range, not one sale (eBay shows these for multi-quantity listings)";
  }
  if (!row.title) return "no listing title to match on";
  return null;
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const [rows, rules, editionResult] = await Promise.all([
  loadRows(source),
  loadActiveScoutRules(admin),
  admin.from("manga_editions").select(EDITION_COLUMNS),
]);
if (editionResult.error) throw new Error(`Could not read the catalogue: ${editionResult.error.message}`);

const editions = editionResult.data ?? [];
const byIsbn = new Map();
for (const edition of editions) {
  const key = normalizeIsbn(edition.isbn_13);
  if (!key) continue;
  if (!byIsbn.has(key)) byIsbn.set(key, []);
  byIsbn.get(key).push(edition);
}

console.log(`rows: ${rows.length}   catalogue: ${editions.length} editions, ${byIsbn.size} distinct ISBNs`);
console.log(`learned Scout rules active: ${rules.length}`);

const buckets = { keep: [], human: [], drop: [] };

for (const row of rows) {
  const label = `${String(row.itemId ?? "?").padEnd(13)} ${String(row.title ?? "").slice(0, 62)}`;

  const unusable = priceDisqualifier(row);
  if (unusable) {
    buckets.drop.push({ label, why: unusable });
    continue;
  }

  // `keyword` is whatever the search was given. When that was an ISBN it ties
  // the row to a specific edition; anything else cannot, and says so.
  const isbn = normalizeIsbn(row.keyword);
  if (isbn.length < 10) {
    buckets.drop.push({ label, why: `searched by free text ${JSON.stringify(row.keyword)}, which names no edition` });
    continue;
  }
  const candidates = byIsbn.get(isbn) ?? [];
  if (!candidates.length) {
    buckets.drop.push({ label, why: `ISBN ${isbn} is not in the catalogue` });
    continue;
  }

  const scored = candidates
    .map((edition) => ({ edition, assessment: assessScoutListing(edition, row.title, rules) }))
    .sort((a, b) => b.assessment.score - a.assessment.score);

  // Scout's own threshold, deliberately. assessScoutListing reserves "strong"
  // for a title that independently supplies the ISBN, publisher or language,
  // and real eBay titles mostly supply none of them -- "One Piece, Vol. 1"
  // scores 50. Scout does not demand "strong" either: it auto-dismisses a
  // lead only on a title-text CONTRADICTION (a multi-volume lot, a different
  // volume, the wrong publisher or binding, a magazine issue sold as a book)
  // and shows a person everything else. Holding this script to a higher bar
  // than the live pipeline would discard almost every genuine sale, and would
  // buy nothing: a queued row costs one eBay API call, eBay decides whether
  // it sold, and a person still confirms before it becomes evidence.
  const viable = scored.filter((entry) => entry.assessment.confidence !== "conflict");

  if (!viable.length) {
    const best = scored[0];
    buckets.drop.push({ label, why: best.assessment.conflicts.join("; ") || "title contradicts this edition" });
    continue;
  }

  // On the three ISBNs that carry two printings, a clear score gap means the
  // title named something that separates them. A tie means it did not, and
  // guessing between a first printing and a later one is exactly the kind of
  // claim that has to be a person's.
  const tied = viable.length > 1 && viable[0].assessment.score === viable[1].assessment.score;
  if (tied) {
    buckets.human.push({
      label,
      why: "this ISBN covers two printings and the title does not say which",
      scored: viable,
    });
  } else {
    buckets.keep.push({ label, pick: viable[0], runnerUp: viable[1] ?? null });
  }
}

function heading(text) {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

heading(`WOULD QUEUE FOR AN EBAY CHECK  (${buckets.keep.length})`);
for (const entry of buckets.keep) {
  const edition = entry.pick.edition;
  const variant = edition.variant_name ? ` [${edition.variant_name}]` : "";
  const assessment = entry.pick.assessment;
  console.log(entry.label);
  console.log(`   -> ${edition.series} vol ${edition.volume_number}${variant}  ${assessment.confidence} ${assessment.score}  ${edition.id}`);
  if (entry.runnerUp) {
    const other = entry.runnerUp;
    console.log(`      chosen over printing=${other.edition.printing_number ?? "-"} (${other.assessment.score})`);
  }
}

heading(`NEEDS A HUMAN  (${buckets.human.length})`);
for (const entry of buckets.human) {
  console.log(entry.label);
  console.log(`   ${entry.why}`);
  for (const candidate of entry.scored) {
    const variant = candidate.edition.variant_name ? ` [${candidate.edition.variant_name}]` : "";
    console.log(`     candidate: ${candidate.edition.series} vol ${candidate.edition.volume_number}${variant} printing=${candidate.edition.printing_number ?? "-"}`);
  }
  for (const line of entry.detail ?? []) console.log(`     ${line}`);
}

heading(`DROPPED  (${buckets.drop.length})`);
for (const entry of buckets.drop) {
  console.log(entry.label);
  console.log(`   ${entry.why}`);
}

heading("SUMMARY");
console.log(`queue for an eBay check : ${buckets.keep.length}`);
console.log(`needs a human           : ${buckets.human.length}`);
console.log(`dropped                 : ${buckets.drop.length}`);
console.log(`total                   : ${rows.length}`);
console.log("\nNothing was written. No row here is a sale; each kept row is only a");
console.log("listing worth asking eBay about directly.");
