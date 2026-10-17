// Ambiguous listing outcomes whose availability was already established.
//
//   node --env-file=.env.local scripts/report-ambiguous-availability.mjs
//
// READ ONLY. It writes nothing, promotes nothing and confirms nothing.
//
// Why this exists. An outcome check asks "did this listing end, and did it
// sell?" eBay only supplies an end date for auctions, so a fixed-price
// Good-'Til-Cancelled listing never answers it: the check runs five times,
// eBay says "active" each time because the listing genuinely is active, and
// the row parks as `ambiguous`. That pile does not drain -- it was 603 on
// 30 September and 1790 on 17 October.
//
// Meanwhile Scout's availability checker looks at the same eBay items and
// asks a question they CAN answer: "is this still buyable?" On a sample of
// 400 ambiguous outcomes, 94% had a matching scout lead by external_id, and
// the checker had already resolved 36 of them as gone -- most of those
// "out of stock", which on a fixed-price listing is what a sale looks like.
//
// So the evidence is already bought and paid for and simply never reaches
// the outcome. This prints it next to each row so a person can decide.
//
// It deliberately does not reclassify anything. "Out of stock" means a
// listing is no longer buyable, which is a sale OR a withdrawal, and only a
// human may decide which -- see the evidence rules in AGENTS.md. The point
// is to put a candidate in front of someone, not to create evidence.
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

/** Chunked, because `in` has a practical ceiling and silence is not an answer. */
async function lookupByExternalId(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await admin
      .from("scout_listing_leads")
      .select("id,external_id,review_status,availability_status,availability_checked_at")
      .in("external_id", ids.slice(i, i + 100));
    if (error) throw new Error(`scout_listing_leads: ${error.message}`);
    out.push(...(data ?? []));
  }
  return out;
}

const ambiguous = await readAll(
  "listing_outcomes",
  "id,external_id,listing_title,buying_format,check_attempts,source_listing_url,edition_id",
  (query) => query.eq("status", "ambiguous").is("reviewed_by", null).is("resulting_observation_id", null),
);
console.log(`Ambiguous outcomes awaiting a person: ${ambiguous.length}`);

const externalIds = [...new Set(ambiguous.map((row) => row.external_id).filter(Boolean))];
const leads = await lookupByExternalId(externalIds);
const leadByExternalId = new Map(leads.map((lead) => [lead.external_id, lead]));

// The dismissal note is where the availability check records WHY a listing
// went away, and the distinction matters: "out of stock" is sale-shaped,
// "ended on <date>" is not necessarily.
const dismissedLeadIds = leads.filter((lead) => lead.review_status === "dismissed").map((lead) => lead.id);
const notes = [];
for (let i = 0; i < dismissedLeadIds.length; i += 100) {
  const { data, error } = await admin
    .from("scout_lead_decisions")
    .select("lead_id,decision_notes,created_at")
    .in("lead_id", dismissedLeadIds.slice(i, i + 100));
  if (error) throw new Error(`scout_lead_decisions: ${error.message}`);
  notes.push(...(data ?? []));
}
const noteByLeadId = new Map();
for (const note of notes) {
  if (!/availability check/i.test(String(note.decision_notes))) continue;
  noteByLeadId.set(note.lead_id, String(note.decision_notes).replace(/^.*availability check:\s*/i, "").trim());
}

const buckets = { outOfStock: [], ended: [], gone: [], stillActive: [], neverChecked: [], noLead: [] };
for (const outcome of ambiguous) {
  const lead = leadByExternalId.get(outcome.external_id);
  if (!lead) { buckets.noLead.push({ outcome }); continue; }
  const reason = noteByLeadId.get(lead.id) ?? null;
  const gone = lead.availability_status === "unavailable" || Boolean(reason);
  if (!gone) {
    (lead.availability_checked_at ? buckets.stillActive : buckets.neverChecked).push({ outcome, lead });
    continue;
  }
  const entry = { outcome, lead, reason };
  if (/out of stock/i.test(reason ?? "")) buckets.outOfStock.push(entry);
  else if (/ended on/i.test(reason ?? "")) buckets.ended.push(entry);
  else buckets.gone.push(entry);
}

const pct = (n) => `${((100 * n) / (ambiguous.length || 1)).toFixed(1)}%`;
console.log(`Matched to a scout lead by external_id: ${leadByExternalId.size} of ${externalIds.length}`);
console.log("");
console.log("ALREADY ANSWERED — availability was established and never reached the outcome");
console.log(`  out of stock -- sale-shaped, needs a person  : ${buckets.outOfStock.length}  (${pct(buckets.outOfStock.length)})`);
console.log(`  ended on a date eBay supplied at check time  : ${buckets.ended.length}  (${pct(buckets.ended.length)})`);
console.log(`  item id gone / other                         : ${buckets.gone.length}  (${pct(buckets.gone.length)})`);
console.log("");
console.log("NOT ANSWERED");
console.log(`  lead checked, still active                   : ${buckets.stillActive.length}  (${pct(buckets.stillActive.length)})`);
console.log(`  lead never availability-checked              : ${buckets.neverChecked.length}  (${pct(buckets.neverChecked.length)})`);
console.log(`  no scout lead for this item                  : ${buckets.noLead.length}  (${pct(buckets.noLead.length)})`);

console.log("\n--- sale candidates a person could decide today ---");
for (const { outcome, reason } of buckets.outOfStock.slice(0, 25)) {
  console.log(`  ${outcome.external_id}  attempts=${outcome.check_attempts}  ${String(outcome.listing_title).slice(0, 52)}`);
  console.log(`      ${reason}`);
  console.log(`      ${outcome.source_listing_url ?? "(no source url)"}`);
}
if (buckets.outOfStock.length > 25) console.log(`  ... and ${buckets.outOfStock.length - 25} more`);
console.log("\nNothing was written. Confirming any of these is a human decision on /listing-outcomes.");
