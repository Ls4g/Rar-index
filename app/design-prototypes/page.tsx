import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import { supabase } from "@/lib/supabase";

// Two homepage treatments for the covers RAR has already verified, built here
// rather than as a mockup so they inherit the real palette, the real Archivo
// and the real artwork. Unlinked on purpose: this is a decision aid, and
// whichever one wins gets moved into app/page.tsx and this page deleted.
//
// Both take the same two ideas from Cosmos and nothing else. Colour comes only
// from the covers, and the surfaces are flat -- no shadow anywhere on this
// page, so depth comes from the artwork sitting on plain ground. The typeface
// stays Archivo: Cosmos uses a whisper-weight didone, which is the exact
// direction rejected in August for making the site read old.
export const dynamic = "force-dynamic";

type Cover = { series: string | null; volume_number: string | null; cover_image_url: string | null };

// Deterministic, so the wall does not rearrange itself on every request and
// the two treatments can be compared like for like.
function seeded(index: number, salt: number) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export default async function DesignPrototypesPage() {
  const { data } = await supabase
    .from("manga_editions")
    .select("series, volume_number, cover_image_url")
    .eq("cover_verification_status", "verified")
    .not("cover_image_url", "is", null)
    .limit(40);

  const covers = (data ?? []) as Cover[];
  // Deduplicated: the same artwork twice in a scatter reads as a mistake.
  const unique = [...new Map(covers.map((cover) => [cover.cover_image_url, cover])).values()];

  const constellation = unique.slice(0, 22).map((cover, index) => ({
    cover,
    // Kept out of the middle band so nothing fights the headline.
    left: 2 + seeded(index, 1) * 92,
    top: seeded(index, 2) * 88,
    size: 62 + seeded(index, 3) * 78,
    rotate: (seeded(index, 4) - 0.5) * 8,
    dim: seeded(index, 5) < 0.35,
  })).filter((item) => item.left < 30 || item.left > 62 || item.top < 22 || item.top > 70);

  const wall = unique.slice(0, 34);

  return (
    <main className="prototype-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/">Current homepage →</Link>
        <ThemeToggle />
      </header>

      <section className="prototype-intro">
        <h1>Two cover-wall treatments</h1>
        <p>
          Both use {unique.length} verified covers from the live catalogue, both are completely flat, and both keep Archivo.
          Switch the theme in the header to see each on Night and Day.
        </p>
      </section>

      {/* ---------------------------------------------------------------- A */}
      <section className="prototype-block">
        <p className="prototype-label">Option A · Constellation</p>
        <div className="constellation">
          <div className="constellation-field" aria-hidden="true">
            {constellation.map((item, index) => (
              /* eslint-disable-next-line @next/next/no-img-element -- publisher CDNs, not configured next/image hosts */
              <img
                alt=""
                className={`constellation-cover${item.dim ? " is-recessed" : ""}`}
                key={`${item.cover.cover_image_url}-${index}`}
                loading="lazy"
                src={item.cover.cover_image_url as string}
                style={{
                  left: `${item.left}%`,
                  top: `${item.top}%`,
                  width: `${item.size}px`,
                  transform: `rotate(${item.rotate.toFixed(2)}deg)`,
                }}
              />
            ))}
          </div>
          <div className="constellation-copy">
            <p className="constellation-kicker">RAR Index</p>
            <h2>What is your manga actually worth?</h2>
            <p>Verified sales, exact editions, and the printing you actually own.</p>
            <div className="constellation-actions">
              <span className="prototype-button">Search the catalogue</span>
              <span className="prototype-button is-quiet">Track your collection</span>
            </div>
          </div>
        </div>
        <p className="prototype-note">
          Sparse and airy. The covers orbit the question rather than competing with it, and roughly a third sit back at lower
          opacity to give depth without a single shadow. Closest to Cosmos. Works with the 65 covers you have now, and keeps
          working at 500 because it only ever shows about twenty.
        </p>
      </section>

      {/* ---------------------------------------------------------------- B */}
      <section className="prototype-block">
        <p className="prototype-label">Option B · The wall</p>
        <div className="cover-wall">
          <div className="cover-wall-grid" aria-hidden="true">
            {wall.map((cover, index) => (
              /* eslint-disable-next-line @next/next/no-img-element -- publisher CDNs, not configured next/image hosts */
              <img
                alt=""
                className="cover-wall-tile"
                key={`${cover.cover_image_url}-${index}`}
                loading="lazy"
                src={cover.cover_image_url as string}
                style={{ transform: `rotate(${((seeded(index, 7) - 0.5) * 3).toFixed(2)}deg)` }}
              />
            ))}
          </div>
          <div className="cover-wall-copy">
            <p className="constellation-kicker">RAR Index</p>
            <h2>What is your manga actually worth?</h2>
            <p>Verified sales, exact editions, and the printing you actually own.</p>
            <div className="constellation-actions">
              <span className="prototype-button">Search the catalogue</span>
              <span className="prototype-button is-quiet">Track your collection</span>
            </div>
          </div>
        </div>
        <p className="prototype-note">
          Dense and abundant. Every cover RAR holds, tiled edge to edge with a degree or two of rotation so it reads as a
          collection rather than a product grid, with the headline cut into the middle of it. Argues that RAR has depth --
          which also means it gets stronger as the catalogue grows, and looks thinnest today.
        </p>
      </section>

      <section className="prototype-intro">
        <p className="prototype-note">
          Neither is wired into the homepage. Say which one and it moves into <code>app/page.tsx</code> and this page goes.
        </p>
      </section>
    </main>
  );
}
