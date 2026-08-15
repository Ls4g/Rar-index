import { createClient } from "@supabase/supabase-js";
import { inspectScoutAutoDismissCandidates } from "../lib/scoutAutoTriage.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const { examined, candidates } = await inspectScoutAutoDismissCandidates(admin);
const byConflict = new Map();
const samplesByConflict = new Map();
for (const candidate of candidates) {
  for (const conflict of candidate.conflicts) {
    byConflict.set(conflict, (byConflict.get(conflict) ?? 0) + 1);
    const samples = samplesByConflict.get(conflict) ?? [];
    if (samples.length < 5) samples.push({ listing: candidate.listing_title, target: candidate.target_title });
    samplesByConflict.set(conflict, samples);
  }
}

console.log(JSON.stringify({
  examined,
  safeDismissCandidates: candidates.length,
  humanQueueRemaining: examined - candidates.length,
  conflicts: [...byConflict.entries()].sort((a, b) => b[1] - a[1]),
  samplesByConflict: Object.fromEntries(samplesByConflict),
}, null, 2));
