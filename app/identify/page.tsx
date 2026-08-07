import Link from "next/link";
import Image from "next/image";
import IdentificationTool from "@/components/IdentificationTool";

export default function IdentifyPage() {
  return <main className="public-page">
    <header className="site-header">
      <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
      <nav className="header-links" aria-label="Main navigation"><Link className="header-note" href="/browse">Browse editions</Link><Link className="header-note" href="/portfolio">Portfolio -&gt;</Link></nav>
    </header>
    <section className="tool-hero">
      <p className="eyebrow">Collector research tool</p>
      <h1>Identify this copy.</h1>
      <p>Use the physical copyright page to work out what needs proving. RAR never confirms a first printing from a listing title alone.</p>
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
