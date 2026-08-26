import Link from "next/link";
import CoverConstellation from "@/components/CoverConstellation";
import CoverWall from "@/components/CoverWall";
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

  const toCover = (cover: Cover) => ({ url: cover.cover_image_url as string, label: [cover.series, cover.volume_number].filter(Boolean).join(" ") });
  const constellationCovers = unique.slice(0, 24).map(toCover);
  const wallCovers = unique.slice(0, 36).map(toCover);

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
        <CoverConstellation covers={constellationCovers} />
        <p className="prototype-note">
          Sparse and airy. The covers orbit the question rather than competing with it, and roughly a third sit back at lower
          opacity to give depth without a single shadow. Closest to Cosmos. Works with the 65 covers you have now, and keeps
          working at 500 because it only ever shows about twenty.
        </p>
      </section>

      {/* ---------------------------------------------------------------- B */}
      <section className="prototype-block">
        <p className="prototype-label">Option B · The wall</p>
        <CoverWall covers={wallCovers} />
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
