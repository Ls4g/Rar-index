<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# RAR Index — project rules

RAR Index is a manga collectibles catalogue + market-intelligence tool (Next.js 16 App Router + Supabase). Staff auth is a shared credential + HMAC session cookie (`lib/staffSession.ts`), gated by `proxy.ts` — not per-user Supabase Auth.

## Evidence rules (non-negotiable)

These apply to every pricing/valuation feature, no exceptions, even under time pressure or an explicit request to "just get more coverage":

- Never create or verify a sale unless it is a **completed sale with a working original source link**.
- Never use active listings, ended-unsold listings, or listing titles alone as sale evidence. Active listings (Scout) are buying-opportunity leads only — they must never affect valuation or charts.
- A sale must attach to the **exact RAR edition** (ISBN, publisher, printing, binding all consistent). If it can't be distinguished confidently, it becomes a Scout/review lead, never a verified sale.
- Keep raw and graded sales in separate comparison groups (see `comparisonGroup()` in `lib/fx.ts`); charts need 3+ in the *same* group.
- Never invent prices, dates, currencies, ISBNs, or edition claims. If data isn't there, say so — don't fill the gap.
- When scope has to be cut for time, cut it explicitly and report the exact gaps left, rather than silently thinning the evidence bar to cover more ground.

## Human-in-the-loop, not automated verification

Automation (Scout auto-triage, matching scorers, etc.) may only ever narrow *what a human looks at* — auto-**dismissing** an obviously-wrong lead is fine; auto-**verifying** a match or a sale is not, ever. Any new automation must:
- never overwrite a human's prior review decision,
- log its own decisions to the same audit-trail tables humans use (e.g. `scout_lead_decisions`, `price_review_decisions`) so it stays inspectable,
- be validated against real/representative titles before shipping (a standalone Node script reproducing the logic is fine when live API creds aren't available locally).

## Known gotchas

- **Supabase SQL editor**: typing SQL directly into the Monaco editor is unreliable (stale snippet state). Use `window.monaco.editor.getModels()[0].setValue(sql)` via a JS-exec browser tool, then click Run.
- **`preview_start` browser tool**: has a persistent stale-PATH bug on this machine. Workaround: run `pnpm run dev` via a background shell after prepending `$env:PATH = "C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:PATH`, then open a browser tab to `http://localhost:3000` directly.
- **Local `.env.local`** has Supabase creds and local-only throwaway staff creds, but no eBay API creds — Scout/eBay-dependent code can't be exercised live from local dev; verify eBay-touching logic with a standalone script instead.
- Browser automation tools default to the "active" tab when `tabId` is omitted — always pass an explicit `tabId` once more than one tab is open.
- **Mobile layout: `resize_window` is broken, but an iframe works.** `resize_window` reports success while `window.innerWidth` stays 1920, so media queries never fire. The workaround is to inject a same-origin iframe at the target width and inspect *its* document — an iframe gets a real viewport, so `matchMedia("(max-width:600px)")` genuinely matches inside it and computed styles are the real mobile ones:
  ```js
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;top:0;left:0;width:390px;height:844px;z-index:2147483647";
  f.src = "/"; document.body.appendChild(f);
  // then read f.contentDocument / f.contentWindow: innerWidth, matchMedia,
  // getComputedStyle, and anything with getBoundingClientRect().right >
  // innerWidth to catch horizontal overflow.
  ```
  Remove the iframe afterwards. Staff pages still can't be checked this way — they sit behind a login whose password must not be typed into a form — so for those, verify via the compiled CSS under `.next/**/*.css`, say plainly in the commit that rendering is unverified, and ask for a phone check. Two real bugs (a right-anchored nav panel opening off the left edge, an unrendered link) were both found by the user on a phone, not locally.
- **Local pages don't hydrate unless `127.0.0.1` is an allowed dev origin.** The browser tooling cannot attach to `localhost` (it rejects the URL as browser-internal), only `127.0.0.1` — and Next dev blocks its own client bundle from hosts it treats as cross-origin. The symptom is nasty: the page renders its server HTML perfectly, so it looks fine, but nothing is interactive and every `useSyncExternalStore` control shows its *server* snapshot (the theme toggle claims Night on a Day page). `next.config.ts` now sets `allowedDevOrigins: ["127.0.0.1"]`; do not remove it. Before concluding an interactive control is broken, check hydration first.
- **A long-running dev server goes stale and silently serves empty data.** A `next dev` left running for days rendered the homepage with every Supabase query returning nothing — zero counts, no covers — while the same queries returned real rows from a standalone script. Restart the dev server before believing an "empty database".
- **Corepack, not a global `pnpm`.** `pnpm` is not on PATH; `corepack pnpm ...` is (after the PATH prepend above).
- `CLAUDE.md` at the repo root just points here via `@AGENTS.md` — edit this file, not that one.

## Workflow expectations

- Every DB schema/function change ships as an additive migration file under `supabase/migrations/`, applied live via the SQL editor, and is never destructive to existing columns/data without explicit confirmation.
- Run `pnpm run lint`, `pnpm exec tsc --noEmit`, and a full `pnpm run build` before considering a change done.
- For UI changes, verify in the browser against real data (local dev or, for view-only checks, the live site) before reporting success — type-checking is not feature verification.
- Reuse existing workflows (Scout, collection profiles, price-import, review) rather than building parallel ones for the same job.
- Always `git push` immediately after committing on this repo — no separate confirmation needed.

