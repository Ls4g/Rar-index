import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(new URL("../app/catalogue-review/page.tsx", import.meta.url), "utf8");
const runner = fs.readFileSync(new URL("../components/CatalogueCuratorRunButton.tsx", import.meta.url), "utf8");
const importer = fs.readFileSync(new URL("../components/CatalogueImportForm.tsx", import.meta.url), "utf8");
const oldImportPage = fs.readFileSync(new URL("../app/catalogue-import/page.tsx", import.meta.url), "utf8");
const nav = fs.readFileSync(new URL("../components/StaffNav.tsx", import.meta.url), "utf8");

let checks = 0;
function check(label, condition) {
  assert.ok(condition, label);
  checks += 1;
  console.log(`  ok   ${label}`);
}

console.log("\nCatalogue workspace simplification");
check("the main Catalogue page can run discovery", /<CatalogueCuratorRunButton\s*\/>/.test(page));
check("the main Catalogue page contains manual intake", /<CatalogueImportForm\s*\/>/.test(page));
check("the main Catalogue page leads to cover review", /href="\/cover-review"/.test(page));
check("the Curator uses the existing audited agent endpoint", /command: "run_agent", agentKey: "catalogue_curator"/.test(runner));
check("the Curator runner cannot approve or publish a record", !/catalogue-review|approve_new|verified edition/i.test(runner));
check("manual intake refreshes the shared queue", /router\.refresh\(\)/.test(importer));
check("the old importer has become a compatibility redirect", /redirect\("\/catalogue-review#manual-import"\)/.test(oldImportPage));
check("candidate import is no longer a separate staff destination", !/href: "\/catalogue-import"/.test(nav));

console.log(`\nPASSED: ${checks}/${checks} checks\n`);
