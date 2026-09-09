import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const portfolio = await readFile(new URL("../components/PortfolioClient.tsx", import.meta.url), "utf8");
const auth = await readFile(new URL("../components/portfolio/PortfolioAuth.tsx", import.meta.url), "utf8");
const modal = await readFile(new URL("../components/portfolio/HoldingModal.tsx", import.meta.url), "utf8");
const shelfMigration = await readFile(new URL("../supabase/migrations/20260815_public_shelf.sql", import.meta.url), "utf8");

assert.match(portfolio, /resetPasswordForEmail\(email\.trim\(\), \{ redirectTo \}\)/, "Recovery must send a link back to the portfolio");
assert.match(portfolio, /event === "PASSWORD_RECOVERY"/, "Recovery links must enter password-update mode");
assert.match(portfolio, /updateUser\(\{ password: newPassword \}\)/, "Recovery must let the authenticated link owner set a password");
assert.match(auth, /disabled=\{busy\}/, "Auth submissions must be disabled while pending");

assert.match(modal, /document\.body\.style\.overflow = "hidden"/, "The mobile page must not scroll behind the holding modal");
assert.match(modal, /event\.key !== "Tab"/, "Keyboard focus must remain inside the modal");
assert.match(modal, /\}, \[open\]\);/, "Typing must not recreate the modal focus effect");

const viewSelect = shelfMigration.match(/create or replace view public\.public_shelf_editions[\s\S]*?from public\.portfolio_holdings/)?.[0] ?? "";
for (const privateColumn of ["purchase_price", "purchase_currency", "purchase_date", "notes", "quantity", "user_id"]) {
  assert.doesNotMatch(viewSelect, new RegExp(`\\b${privateColumn}\\b`), `Public shelf view must not expose ${privateColumn}`);
}
assert.match(shelfMigration, /where profile\.shelf_is_public/, "A shelf must require the owner's explicit public opt-in");

console.log("Collector journey regression checks passed.");
