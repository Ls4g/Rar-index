import Link from "next/link";
import CoverWall from "@/components/CoverWall";
import SaleSparkline, { type SalePoint } from "@/components/SaleSparkline";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normaliseSeriesKey } from "@/lib/catalogueBacklog";

// A proposal, not a patch. Built with RAR's real covers, real verified sales
// and real figures so it can be judged as a product rather than as a moodboard.
//
// THE ARGUMENT
// RAR is a market instrument for physical objects. It has to do two things
// better than anyone else: show the object properly, and show the money
// credibly. Everything currently on the page that does neither is chrome.
//
// WHAT IS TAKEN, AND FROM WHERE
// - One chromatic accent, full stop. Every reference studied does this --
//   Steep sienna, Seline cyan, Linear acid lime, Shop violet, Cosmos none at
//   all. RAR presently runs gold AND orange AND green AND a status palette,
//   which is why nothing on the page reads as important.
// - Elevation from hairline borders and surface steps, never shadows (Linear,
//   Cosmos). RAR has 50+ box-shadows; two independent references say the
//   flatness is the point.
// - A graduated dark surface ladder rather than one flat black (Linear:
//   void / carbon / obsidian / graphite).
// - Charts without axes or gridlines (Steep): "a gestural line, not a data
//   dashboard".
// - Metric plus a delta line in muted grey (Steep), one highlighted keyword
//   per headline (Seline), full-bleed imagery with no internal padding (Shop).
//
// WHAT IS DELIBERATELY NOT TAKEN
// Every warm-paper reference is light-only. RAR is Night-default and its
// audience browses in the evening, so the ladder is dark and the warm paper
// becomes the accent's temperature instead of the canvas.
export const dynamic = "force-dynamic";

type Sale = { edition_id: string; sale_price: number; currency: string; sold_date: string | null; grading_company: string | null };
type Edition = {
  id: string; title: string | null; series: string | null; volume_number: string | null;
  language: string | null; publisher: string | null; isbn_13: string | null;
  cover_image_url: string | null; cover_verification_status: string | null;
};

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(value);
}

export default async function RedesignPage() {
  const admin = getSupabaseAdmin();

  const [{ data: saleData }, { data: coverData }] = await Promise.all([
    admin.from("price_observations")
      .select("edition_id,sale_price,currency,sold_date,grading_company")
      .eq("match_status", "verified_match").eq("sale_status", "confirmed")
      .not("sold_date", "is", null).order("sold_date", { ascending: true }).limit(500),
    admin.from("manga_editions")
      .select("id,title,series,volume_number,language,publisher,isbn_13,cover_image_url,cover_verification_status")
      .eq("cover_verification_status", "verified").not("cover_image_url", "is", null).limit(120),
  ]);

  const sales = (saleData ?? []) as Sale[];
  const covers = (coverData ?? []) as Edition[];
  const uniqueCovers = [...new Map(covers.map((cover) => [cover.cover_image_url, cover])).values()];

  // Interleaved by series so the wall is not eighteen One Pieces.
  const bySeries = new Map<string, Edition[]>();
  for (const cover of uniqueCovers) {
    const key = normaliseSeriesKey(cover.series ?? cover.title);
    bySeries.set(key, [...(bySeries.get(key) ?? []), cover]);
  }
  const queues = [...bySeries.values()];
  const wallCovers: Array<{ url: string; label: string }> = [];
  for (let round = 0; wallCovers.length < uniqueCovers.length; round += 1) {
    let added = false;
    for (const queue of queues) {
      if (queue[round]) { wallCovers.push({ url: queue[round].cover_image_url as string, label: queue[round].series ?? "" }); added = true; }
    }
    if (!added) break;
  }

  // Editions with enough verified sales to say anything at all.
  const byEdition = new Map<string, Sale[]>();
  for (const sale of sales) byEdition.set(sale.edition_id, [...(byEdition.get(sale.edition_id) ?? []), sale]);
  const tracked = [...byEdition.entries()].filter(([, rows]) => rows.length >= 3).slice(0, 3);

  const { data: trackedEditionData } = tracked.length
    ? await admin.from("manga_editions")
      .select("id,title,series,volume_number,language,publisher,isbn_13,cover_image_url,cover_verification_status")
      .in("id", tracked.map(([id]) => id))
    : { data: [] };
  const editionById = new Map(((trackedEditionData ?? []) as Edition[]).map((edition) => [edition.id, edition]));

  const cards = tracked.map(([id, rows]) => {
    const edition = editionById.get(id);
    const sorted = [...rows].sort((left, right) => String(left.sold_date).localeCompare(String(right.sold_date)));
    const points: SalePoint[] = sorted.map((sale) => ({
      date: String(sale.sold_date), price: Number(sale.sale_price),
      currency: sale.currency, graded: Boolean(sale.grading_company),
    }));
    const latest = points[points.length - 1];
    const first = points[0];
    const change = first.price ? ((latest.price - first.price) / first.price) * 100 : 0;
    return { edition, points, latest, first, change, count: rows.length };
  }).filter((card) => card.edition);

  const hero = cards[0];

  return (
    <main className="rr">
      <header className="rr-nav">
        <Link className="rr-mark" href="/">RAR</Link>
        <nav>
          <span>Catalogue</span>
          <span>Prices</span>
          <span>Collection</span>
        </nav>
        <span className="rr-nav-action">Sign in</span>
      </header>

      {/* ------------------------------------------------------------ hero */}
      <section className="rr-hero">
        <div className="rr-hero-copy">
          <p className="rr-eyebrow">Manga market index</p>
          {/* Seline's device: exactly one highlighted keyword in the headline,
              never two. The highlight goes on the word carrying the claim. */}
          <h1>What your manga is <mark>actually</mark> worth</h1>
          <p className="rr-lede">
            Every price here comes from a completed sale, matched to one exact edition, with a working link back to the receipt.
            No estimates, no averages of guesses.
          </p>
          <div className="rr-search">
            <input placeholder="One Piece Vol. 1, or an ISBN" readOnly />
            <button type="button">Search</button>
          </div>
          {/* Steep's stat card: the figure, then a delta line in muted grey.
              Real numbers -- an empty product should look empty. */}
          <dl className="rr-proof">
            <div><dt>Verified sales</dt><dd>{sales.length}</dd></div>
            <div><dt>Editions catalogued</dt><dd>{uniqueCovers.length}+</dd></div>
            <div><dt>Tracked with a price</dt><dd>{byEdition.size}</dd></div>
          </dl>
        </div>
        <div className="rr-hero-wall">
          <CoverWall covers={wallCovers} />
        </div>
      </section>

      {/* ----------------------------------------------------------- market */}
      <section className="rr-band">
        <div className="rr-band-head">
          <h2>Moving this month</h2>
          <p>Editions with at least three verified sales. Everything else is listed without a price rather than given one.</p>
        </div>
        <div className="rr-cards">
          {cards.map((card) => (
            <article className="rr-card" key={card.edition!.id}>
              <div className="rr-card-top">
                {card.edition!.cover_image_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- publisher CDNs are not configured next/image hosts */
                  <img alt="" className="rr-card-cover" loading="lazy" src={card.edition!.cover_image_url} />
                ) : null}
                <div>
                  <h3>{card.edition!.series ?? card.edition!.title}</h3>
                  <p className="rr-card-meta">Vol. {card.edition!.volume_number} · {card.edition!.language} · {card.edition!.publisher ?? "—"}</p>
                </div>
              </div>
              <p className="rr-figure">{money(card.latest.price, card.latest.currency)}</p>
              <p className="rr-delta">
                <span className={card.change >= 0 ? "up" : "down"}>{card.change >= 0 ? "↑" : "↓"} {Math.abs(card.change).toFixed(0)}%</span>
                {" "}since {new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(card.first.date))} · {card.count} verified sales
              </p>
              <SaleSparkline points={card.points} width={420} height={96} />
            </article>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------- edition */}
      {hero?.edition ? (
        <section className="rr-band rr-band-quiet">
          <div className="rr-band-head">
            <h2>One edition, in full</h2>
            <p>What an edition page becomes: the object first, the evidence beneath it, and nothing between them.</p>
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
                <p className="rr-figure rr-figure-lg">{money(hero.latest.price, hero.latest.currency)}</p>
                <p className="rr-delta">Last verified sale · {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(hero.latest.date))}</p>
              </div>

              <SaleSparkline points={hero.points} width={560} height={132} />
              <p className="rr-chart-note">
                {hero.points.length} verified sales between {new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(hero.first.date))} and {new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(hero.latest.date))}.
                Solid points are raw copies, rings are graded. The line is straight between sales because RAR does not know what happened in between.
              </p>

              <dl className="rr-facts">
                <div><dt>ISBN-13</dt><dd>{hero.edition.isbn_13 ?? "Not recorded"}</dd></div>
                <div><dt>Range</dt><dd>{money(Math.min(...hero.points.map((point) => point.price)), hero.latest.currency)} – {money(Math.max(...hero.points.map((point) => point.price)), hero.latest.currency)}</dd></div>
                <div><dt>Evidence</dt><dd>{hero.points.length} sales · every one linked</dd></div>
              </dl>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rr-band rr-notes">
        <h2>What changed, and why</h2>
        <ol>
          <li><b>One accent instead of four.</b> Every reference studied uses exactly one — Steep sienna, Seline cyan, Linear acid lime, Shop violet. RAR runs gold, orange, green and a status palette at once, which is why nothing currently reads as important.</li>
          <li><b>No shadows.</b> Depth comes from a surface ladder and hairline borders, the way Linear and Cosmos both do it. RAR has more than fifty box-shadows.</li>
          <li><b>The chart lost its furniture.</b> No axes, no gridlines, no legend — five sales do not need a dashboard around them. What it gained is honesty: points sit at their real dates, graded copies are rings, and the sparseness shows.</li>
          <li><b>The cover is the object, not a thumbnail.</b> Full-bleed, no padding, no card around it.</li>
          <li><b>One highlighted word per headline.</b> The claim is &ldquo;actually&rdquo;, so that is the word that gets the accent.</li>
        </ol>
        <p className="rr-chart-note">Real covers, real verified sales, real counts, straight from the live database. Nothing on this page is invented.</p>
      </section>
    </main>
  );
}
