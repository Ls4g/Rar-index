// Creates only the missing eBay collection specifications for verified,
// priority Volume 1 publications. It never creates listings or sale evidence.
// Dry run by default; pass --apply to insert the missing profiles.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { ensurePriorityMarketplaceProfiles } from "../lib/priorityCoverage.ts";

for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#][^=]*)=(.*)$/);
  if (match) process.env[match[1].trim()] ??= match[2].trim().replace(/^['"]|['"]$/g, "");
}

const apply = process.argv.includes("--apply");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const result = await ensurePriorityMarketplaceProfiles(admin, { apply });

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry_run",
  priorityPublications: result.priorityPublications,
  alreadyCovered: result.alreadyCovered,
  missingProfiles: result.missingProfiles,
  created: result.created,
  createdEditionIds: result.createdEditionIds,
  safety: "Collection specifications only; no listing or sale was created or verified.",
}, null, 2));
