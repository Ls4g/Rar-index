import type { Metadata } from "next";
import Link from "next/link";
import PublicHeader from "@/components/PublicHeader";
import { SITE_OPERATOR } from "@/lib/siteOperator";

export const metadata: Metadata = { title: "About — RAR Index", description: "What RAR Index is, where its data comes from, and how prices are checked." };

export default function AboutPage() {
  return <main className="public-page">
    <PublicHeader />
    <section className="tool-hero">
      <p className="eyebrow">About RAR Index</p>
      <h1>A price guide for collectible manga.</h1>
      <p>RAR Index is a catalogue of manga editions, down to publisher, language, ISBN and printing, with what copies of each exact edition have actually sold for.</p>
    </section>
    <section className="tool-content legal-copy">
      <h2>What RAR does</h2>
      <p>Manga prices vary hugely between editions that look alike: a Japanese first print, an English reprint, a graded copy and a 3-in-1 omnibus of the same volume are different collectibles. RAR keeps a separate record for each exact edition and shows prices only from sales of that edition.</p>
      <p>Collectors can also keep a private record of their own shelf, and choose to share a public gallery of it.</p>

      <h2>Where the data comes from</h2>
      <ul>
        <li><strong>Catalogue:</strong> publisher pages and book databases such as Open Library and Google Books, checked by a person before an edition is published. Each edition keeps a link to its source.</li>
        <li><strong>Prices:</strong> completed sales of the exact edition, mainly from eBay. Every price links to the original sold listing. A sale is only counted after a person has checked it is the right edition and a single copy.</li>
        <li><strong>Live listings:</strong> copies currently for sale, shown as buying leads only. They never affect a price.</li>
        <li><strong>Exchange rates:</strong> the European Central Bank's published reference rates, used to compare sales in different currencies.</li>
      </ul>

      <h2>How prices are worked out</h2>
      <p>A price is the median (middle) of recent verified sales in the same group: the same edition and printing, and either ungraded or graded copies, never mixed. A chart needs at least three such sales. If there are not enough, RAR says so rather than guessing.</p>

      <h2>What RAR is not</h2>
      <p>RAR is an independent project. It is not affiliated with, endorsed by or sponsored by eBay or any publisher. Prices are a record of past sales, not a valuation or an offer, and not financial advice. See the <Link href="/terms">Terms of use</Link>.</p>

      <h2>Contact</h2>
      <p>RAR Index is run by {SITE_OPERATOR.name}. For questions, corrections, or a request to remove something, email <a href={`mailto:${SITE_OPERATOR.email}`}>{SITE_OPERATOR.email}</a>. To suggest a manga, use <Link href="/request-edition">Request a manga</Link>.</p>
    </section>
  </main>;
}
