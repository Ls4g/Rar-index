import Link from "next/link";
import CoverWall from "@/components/CoverWall";
import SaleSparkline, { type SalePoint } from "@/components/SaleSparkline";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normaliseSeriesKey } from "@/lib/catalogueBacklog";

// A proposal, rebuilt around what RAR is actually for.
//
// The first version led with "what your manga is actually worth". That is the
// moat, not the reason anyone turns up. People come to track a collection and
// show it off; tracking is what generates the data; the data is what nobody
// else has. So the collection is the product and pricing is what makes it
// defensible -- and the page has to be ordered that way round.
//
// It also matches the audience research already in the repo: 1.93M in
// r/MangaCollectors mention shelving 311 times and grading once. The large
// audience is the display-led one.
//
// The visual language is unchanged from the first pass, because none of it was
// ever about pricing: one chromatic accent (every reference studied uses
// exactly one), depth from a surface ladder and hairlines rather than shadows,
// full-bleed covers with no card around them, and a chart with no axes or
// gridlines.
export const dynamic = "force-dynamic";

type Edition = {
  id: string; title: string | null; series: string | null; volume_number: string | null;
  language: string | null; publisher: string | null; cover_image_url: string | null;
};
type Sale = { edition_id: string; sale_price: number; currency: string; sold_date: string | null; grading_company: string | null };

function money(value: number, currency: string, digits = 0) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: digits }).format(value);
}

export default async function RedesignPage() {
  const admin = getSupabaseAdmin();
  const [{ data: editionData }, { data: saleData }] = await Promise.all([
    admin.from("manga_editions")
      .select("id,title,series,volume_number,language,publisher,cover_image_url")
      .eq("cover_verification_status", "verified").not("cover_image_url", "is", null).limit(200),
    admin.from("price_observations")
      .select("edition_id,sale_price,currency,sold_date,grading_company")
      .eq("match_status", "verified_match").eq("sale_status", "confirmed")
      .not("sold_date", "is", null).order("sold_date", { ascending: true }).limit(500),
  ]);

  const editions = (editionData ?? []) as Edition[];
  const sales = (saleData ?? []) as Sale[];

  // Real English series with their real volume spreads. Naruto genuinely has
  // 1,2,3,4,5,7,8,10 in the catalogue, so the gaps shown below are RAR's own
  // gaps rather than invented ones.
  const englishBySeries = new Map<string, Edition[]>();
  for (const edition of editions) {
    if (edition.language !== "English" || !edition.series) continue;
    const key = normaliseSeriesKey(edition.series);
    englishBySeries.set(key, [...(englishBySeries.get(key) ?? []), edition]);
  }

  const shelves = [...englishBySeries.values()]
    .map((group) => {
      const volumes = [...new Set(group.map((item) => Number(item.volume_number)).filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
      const highest = volumes[volumes.length - 1] ?? 0;
      const missing: number[] = [];
      for (let volume = 1; volume <= highest; volume += 1) if (!volumes.includes(volume)) missing.push(volume);
      const covers = [...new Map(group.map((item) => [item.cover_image_url, item])).values()];
      return { series: group[0].series as string, volumes, highest, missing, covers };
    })
    .filter((shelf) => shelf.highest >= 4)
    .sort((left, right) => right.volumes.length - left.volumes.length)
    .slice(0, 4);

  // Interleaved so the wall is not eighteen One Pieces.
  const bySeries = new Map<string, Edition[]>();
  for (const edition of editions) {
    const key = normaliseSeriesKey(edition.series ?? edition.title);
    bySeries.set(key, [...(bySeries.get(key) ?? []), edition]);
  }
  const queues = [...bySeries.values()];
  const wallCovers: Array<{ url: string; label: string }> = [];
  const seen = new Set<string>();
  for (let round = 0; wallCovers.length < editions.length; round += 1) {
    let added = false;
    for (const queue of queues) {
      const item = queue[round];
      if (item?.cover_image_url && !seen.has(item.cover_image_url)) {
        seen.add(item.cover_image_url);
        wallCovers.push({ url: item.cover_image_url, label: item.series ?? "" });
        added = true;
      }
    }
    if (!added) break;
  }

  const byEdition = new Map<string, Sale[]>();
  for (const sale of sales) byEdition.set(sale.edition_id, [...(byEdition.get(sale.edition_id) ?? []), sale]);
  const priced = [...byEdition.entries()].filter(([, rows]) => rows.length >= 3);

  const hero = priced
    .map(([id, rows]) => {
      const edition = editions.find((item) => item.id === id);
      const sorted = [...rows].sort((left, right) => String(left.sold_date).localeCompare(String(right.sold_date)));
      return { edition, rows: sorted, latest: sorted[sorted.length - 1] };
    })
    .filter((item) => item.edition)
    .sort((left, right) => Number(right.latest.sale_price) - Number(left.latest.sale_price))[0];

  const heroPoints: SalePoint[] = hero
    ? hero.rows.map((sale) => ({ date: String(sale.sold_date), price: Number(sale.sale_price), currency: sale.currency, graded: Boolean(sale.grading_company) }))
    : [];

  const shelfVolumes = shelves.reduce((total, shelf) => total + shelf.volumes.length, 0);

  return (
    <main className="rr">
      <header className="rr-nav">
        <Link className="rr-mark" href="/">RAR</Link>
        <nav><span>My shelf</span><span>Browse</span><span>Prices</span></nav>
        <span className="rr-nav-action">Share shelf</span>
      </header>

      {/* ------------------------------------------------------------ hero */}
      {/* The shelf is the hero. Not a valuation question -- the thing the
          person came to look at, which is their own books. */}
      <section className="rr-hero">
        <div className="rr-hero-copy">
          <p className="rr-eyebrow">Manga collection tracker</p>
          <h1>Build your <mark>manga shelf</mark></h1>
          <p className="rr-lede">
            Add what you own, see what you are missing, and put the whole thing on a page worth sending to someone.
            RAR knows the exact edition — printing, publisher, ISBN — not just the title.
          </p>
          {/* Two real actions rather than a search box that does nothing. A
              read-only field reads as functional and then is not, which is a
              worse first impression than no field at all. */}
          <div className="rr-actions">
            <span className="rr-btn">Start your shelf</span>
            <span className="rr-btn rr-btn-quiet">Browse manga</span>
          </div>
          {/* The edge, stated before anyone scrolls. Tracking still leads, but
              a visitor should know within one screen why this is not just
              another list app. */}
          <p className="rr-edge">Exact editions · verified sold prices · {sales.length} sales with a receipt</p>
        </div>
        <div className="rr-hero-wall">
          {/* Labelled, because a wall of covers next to shelf statistics reads
              as the visitor's own collection to someone who has just arrived.
              It is not, and RAR of all products should not blur that. */}
          <span className="rr-sample-tag">Example collection</span>
          <CoverWall covers={wallCovers} />
        </div>
      </section>

      {/* ------------------------------------------------------ completion */}
      {/* The loop. Someone who can see a hole in a run goes and fills it, and
          filling it is what puts data into RAR. This is the product. */}
      <section className="rr-band">
        <div className="rr-band-head">
          <h2>What you are missing</h2>
          <p>
            Counted against what RAR has catalogued, never against the published run — RAR does not always know how many
            volumes a series has, so it does not claim to. <span className="rr-sample-inline">Example collection</span>
          </p>
        </div>
        <div className="rr-runs">
          {shelves.map((shelf) => (
            <article className="rr-run" key={shelf.series}>
              <div className="rr-run-head">
                <h3>{shelf.series}</h3>
                {/* "of N catalogued volumes", never "complete". RAR knowing ten
                    volumes is not RAR knowing the series has ten -- One Piece
                    has over a hundred and RAR holds fourteen. Saying "complete
                    run" would be the same overclaim as calling something out
                    of print because Scout has not seen one. */}
                <span className="rr-run-count">{shelf.volumes.length} of {shelf.highest} catalogued volumes owned</span>
              </div>
              {/* A spine per volume. Owned spines carry the accent; a gap is a
                  hollow slot, which is the thing that nags. */}
              <ol className="rr-spines" aria-label={`${shelf.series} volumes`}>
                {Array.from({ length: shelf.highest }, (_, index) => index + 1).map((volume) => (
                  <li
                    className={shelf.volumes.includes(volume) ? "is-owned" : "is-gap"}
                    key={volume}
                    title={shelf.volumes.includes(volume) ? `Volume ${volume} — on your shelf` : `Volume ${volume} — missing`}
                  >
                    <span>{volume}</span>
                  </li>
                ))}
              </ol>
              {shelf.missing.length ? (
                <p className="rr-run-gap">
                  Missing <b>{shelf.missing.map((volume) => `Vol. ${volume}`).join(", ")}</b> · <span className="rr-link">find a copy</span>
                </p>
              ) : (
                // Not "complete". No gaps in what RAR holds is a statement
                // about RAR, and the copy has to say which.
                <p className="rr-run-gap rr-run-complete">No gaps in what RAR has catalogued so far</p>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------- show off */}
      <section className="rr-band rr-band-quiet">
        <div className="rr-band-head">
          <h2>A shelf worth sending</h2>
          <p>One link, your covers, no account needed to look. You choose whether it is public, and it shows what you own — never what you paid.</p>
        </div>
        <div className="rr-share">
          <div className="rr-share-card">
            <div className="rr-share-bar"><span className="rr-sample-inline">Example</span><span className="rr-share-url">rarindex.com/collectors/<b>shamar</b></span></div>
            <div className="rr-share-grid">
              {wallCovers.slice(0, 18).map((cover) => (
                /* eslint-disable-next-line @next/next/no-img-element -- publisher CDNs are not configured next/image hosts */
                <img alt="" key={cover.url} loading="lazy" src={cover.url} />
              ))}
            </div>
            <div className="rr-share-foot">
              <span><b>{shelfVolumes}</b> volumes</span>
              <span><b>{shelves.length}</b> series</span>
              <span><b>{sales.length}</b> priced</span>
            </div>
          </div>
          <div className="rr-share-copy">
            <h3>Built to be shown, not audited</h3>
            <p>The public shelf carries covers and counts. Purchase prices, valuations and anything else private stay on your side of the login — a shelf you would happily post in a thread.</p>
            <p className="rr-chart-note">Handles are opt-in, and a shelf that is not public returns nothing rather than confirming the handle exists.</p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ worth */}
      {/* Last, deliberately. The edge that makes RAR hard to copy, offered as
          something you find once you have a shelf -- not as the pitch. */}
      {hero?.edition ? (
        <section className="rr-band">
          <div className="rr-band-head">
            <h2>And then, what it is worth</h2>
            <p>Once a shelf exists, RAR can price it from completed sales matched to the exact edition. This is the part nobody else has — {sales.length} verified sales across {byEdition.size} editions so far.</p>
          </div>
          <div className="rr-edition">
            <div className="rr-edition-object">
              {hero.edition.cover_image_url ? (
                /* eslint-disable-next-line @next/next/no-img-element -- publisher CDNs are not configured next/image hosts */
                <img alt={`${hero.edition.series} Vol. ${hero.edition.volume_number}`} src={hero.edition.cover_image_url} />
              ) : null}
            </div>
            <div className="rr-edition-body">
              <p className="rr-eyebrow">{hero.edition.language} · {hero.edition.publisher}</p>
              <h3>{hero.edition.series ?? hero.edition.title}</h3>
              <p className="rr-edition-volume">Volume {hero.edition.volume_number}</p>
              <div className="rr-edition-price">
                <p className="rr-figure rr-figure-lg">{money(Number(hero.latest.sale_price), hero.latest.currency)}</p>
                <p className="rr-delta">Last verified sale · {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(String(hero.latest.sold_date)))}</p>
              </div>
              <SaleSparkline points={heroPoints} width={560} height={128} />
              <p className="rr-chart-note">
                {heroPoints.length} verified sales, each linked to its receipt. Points sit at their real dates, so uneven months look uneven.
                The line stays straight between sales because RAR does not know what happened in between.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <footer className="rr-foot">
        <p>
          Covers, series, volume gaps and sold prices on this page are real catalogue data. The shelf itself is an example —
          RAR does not have your collection until you add it.
        </p>
      </footer>
    </main>
  );
}
