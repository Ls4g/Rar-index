// Read-only report for the staff Volume 1 coverage programme.
// It never creates editions, profiles, covers, leads or sales.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  COVERAGE_PRIORITY_SERIES,
  coveragePriorityRank,
  coverageStrength,
} from "../lib/coveragePriority.ts";

for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#][^=]*)=(.*)$/);
  if (match) process.env[match[1].trim()] ??= match[2].trim().replace(/^['"]|['"]$/g, "");
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [{ data: editionData, error: editionError }, { data: profileData, error: profileError }] = await Promise.all([
  admin.from("manga_editions")
    .select("id,title,series,volume_number,language,cover_verification_status,printing_of_edition_id,is_verified")
    .eq("is_verified", true).limit(5000),
  admin.from("marketplace_search_profiles").select("id,edition_id").eq("is_active", true).limit(5000),
]);
if (editionError || profileError) throw editionError ?? profileError;

const editions = editionData ?? [];
const volumeOne = editions.filter((edition) => {
  const number = Number.parseInt(String(edition.volume_number ?? ""), 10);
  return number === 1 && (edition.language === "English" || edition.language === "Japanese")
    && Number.isFinite(coveragePriorityRank(edition.series));
});
const roots = volumeOne.filter((edition) => !edition.printing_of_edition_id);
const rootIds = new Set(roots.map((edition) => edition.id));
const rootByMember = new Map(roots.map((edition) => [edition.id, edition.id]));
for (const edition of editions) {
  if (edition.printing_of_edition_id && rootIds.has(edition.printing_of_edition_id)) {
    rootByMember.set(edition.id, edition.printing_of_edition_id);
  }
}
const familyIds = [...rootByMember.keys()];

const { data: saleData, error: saleError } = familyIds.length
  ? await admin.from("price_observations")
    .select("edition_id,match_status,sale_status,grading_company,grade_label")
    .in("edition_id", familyIds).limit(5000)
  : { data: [], error: null };
if (saleError) throw saleError;

const rawSalesByRoot = new Map();
for (const sale of saleData ?? []) {
  if (sale.match_status !== "verified_match" || sale.sale_status !== "confirmed" || sale.grading_company || sale.grade_label) continue;
  const rootId = rootByMember.get(sale.edition_id);
  if (rootId) rawSalesByRoot.set(rootId, (rawSalesByRoot.get(rootId) ?? 0) + 1);
}
const profilesByRoot = new Map();
for (const profile of profileData ?? []) {
  const rootId = rootByMember.get(profile.edition_id);
  if (rootId) profilesByRoot.set(rootId, (profilesByRoot.get(rootId) ?? 0) + 1);
}

const rows = roots.map((edition) => {
  const rawSales = rawSalesByRoot.get(edition.id) ?? 0;
  const activeProfiles = profilesByRoot.get(edition.id) ?? 0;
  const strength = coverageStrength({
    coverVerified: edition.cover_verification_status === "verified",
    hasActiveProfile: activeProfiles > 0,
    comparableSaleCount: rawSales,
  });
  return {
    rank: coveragePriorityRank(edition.series) + 1,
    series: edition.series,
    language: edition.language,
    editionId: edition.id,
    cover: edition.cover_verification_status ?? "missing",
    activeProfiles,
    verifiedRawSales: rawSales,
    strength: strength.strong ? "strong" : `${strength.completed}/3`,
    missing: strength.missing,
  };
}).sort((left, right) => left.rank - right.rank || left.language.localeCompare(right.language));

const represented = new Set(rows.map((row) => `${row.rank}:${row.language}`));
const missingPublications = COVERAGE_PRIORITY_SERIES.flatMap((series, index) => ["English", "Japanese"].flatMap((language) => (
  represented.has(`${index + 1}:${language}`) ? [] : [{ rank: index + 1, series, language }]
)));

console.log(JSON.stringify({
  prioritySeries: COVERAGE_PRIORITY_SERIES.length,
  publishedPriorityVolumeOnes: rows.length,
  strongPublications: rows.filter((row) => row.strength === "strong").length,
  missingPublishedTargets: missingPublications.length,
  rows,
  missingPublications,
  safety: "Read-only coverage report; no records were changed.",
}, null, 2));
