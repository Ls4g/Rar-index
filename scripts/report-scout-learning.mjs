// Read-only production check. Never writes decisions, rules or benchmark rows.
import { createClient } from "@supabase/supabase-js";
import { readHumanScoutDecisions } from "../lib/scoutFeedback.ts";
import { loadActiveScoutRules } from "../lib/scoutRules.ts";
import { createScoutMemory, measureScoutConfidence, splitLearningDecisions } from "../lib/scoutLearningEvidence.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Load RAR's Supabase environment before running this read-only report.");
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const [decisions, rules] = await Promise.all([readHumanScoutDecisions(admin), loadActiveScoutRules(admin)]);
const split = splitLearningDecisions(decisions);
const memory = createScoutMemory(decisions);
console.log(JSON.stringify({
  decisions: decisions.length, development: split.development.length, reserved: split.holdout.length,
  activeRules: rules.map(rule => ({ key: rule.rule_key, version: rule.version })),
  reviewedCasesWithRelatedExamples: decisions.filter(item => memory(item.edition, item.listingTitle, [item.leadId], item.listingKey).length).length,
  confidence: measureScoutConfidence(decisions, rules),
}, null, 2));
