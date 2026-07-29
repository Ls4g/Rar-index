import Link from "next/link";
import IdentificationTool from "@/components/IdentificationTool";

export default function IdentifyPage() {
  return <main>
    <header className="site-header">
      <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
      <nav className="header-links" aria-label="Main navigation"><Link className="header-note" href="/browse">Browse editions</Link><Link className="header-note" href="/portfolio">Portfolio -&gt;</Link></nav>
    </header>
    <section className="tool-hero">
      <p className="eyebrow">Collector research tool</p>
      <h1>Identify this copy.</h1>
      <p>Use the physical copyright page to work out what needs proving. RAR never confirms a first printing from a listing title alone.</p>
    </section>
    <section className="tool-content"><IdentificationTool /></section>
  </main>;
}
