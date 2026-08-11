import Link from "next/link";
import Image from "next/image";
import IdentificationTool from "@/components/IdentificationTool";
import ThemeToggle from "@/components/ThemeToggle";

export default function IdentifyPage() {
  return <main className="public-page">
    <header className="site-header">
      <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
      <nav className="header-links" aria-label="Main navigation"><Link className="header-note" href="/browse">Browse manga</Link><Link className="header-note" href="/portfolio">Portfolio -&gt;</Link><ThemeToggle /></nav>
    </header>
    <section className="tool-hero">
      <p className="eyebrow">First-print check</p>
      <h1>Is your copy a first print?</h1>
      <p>Have the book in front of you and open the copyright page — that page, not the cover or the listing, is what settles it. A seller calling something a first edition is not evidence, and we never treat it as such.</p>
    </section>
    <section className="tool-content">
      <section className="identify-example" aria-labelledby="identify-example-heading">
        <div>
          <p className="eyebrow">Japanese example</p>
          <h2 id="identify-example-heading">Look for the printing line.</h2>
          <p>On many Japanese manga copyright pages, <strong>第1刷発行</strong> identifies the first printing. This is an illustrative guide, not proof for every publisher or copy.</p>
        </div>
        <Image src="/identify-first-print-example.svg" alt="Illustrative Japanese copyright page with the first-printing notation 第1刷発行 highlighted" width={720} height={430} />
      </section>
      <IdentificationTool />
    </section>
  </main>;
}
