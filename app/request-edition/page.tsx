import Link from "next/link";
import EditionRequestForm from "@/components/EditionRequestForm";

export default function RequestEditionPage() {
  return <main className="public-page">
    <header className="site-header">
      <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
      <nav className="header-links" aria-label="Main navigation"><Link className="header-note" href="/identify">Identify this copy</Link><Link className="header-note" href="/portfolio">Portfolio -&gt;</Link></nav>
    </header>
    <section className="tool-hero">
      <p className="eyebrow">Community catalogue request</p>
      <h1>Request an edition.</h1>
      <p>Know an edition that should exist in RAR? Send the best source you have. Requests are researched before they enter the catalogue.</p>
    </section>
    <section className="tool-content"><EditionRequestForm /></section>
  </main>;
}
