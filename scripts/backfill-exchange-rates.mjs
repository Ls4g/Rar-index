// Review first: node --env-file=.env.local scripts/backfill-exchange-rates.mjs
// Apply once:  node --env-file=.env.local scripts/backfill-exchange-rates.mjs --apply
import { EARLIEST_RATE_DATE, fetchEcbRates, upsertEcbRates } from "../lib/ecbExchangeRates.ts";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.ts";

const rows = await fetchEcbRates(EARLIEST_RATE_DATE);
console.log(JSON.stringify({ rows: rows.length, firstDate: rows[0]?.rate_date, latestDate: rows.at(-1)?.rate_date, currencies: [...new Set(rows.map((row) => row.currency))], mode: process.argv.includes("--apply") ? "apply" : "dry-run" }));
if (process.argv.includes("--apply")) {
  console.log(`Saved ${await upsertEcbRates(getSupabaseAdmin(), rows)} ECB reference rates.`);
}
