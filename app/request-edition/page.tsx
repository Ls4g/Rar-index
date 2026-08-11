import Link from "next/link";
import EditionRequestForm from "@/components/EditionRequestForm";
import ThemeToggle from "@/components/ThemeToggle";

export default function RequestEditionPage() {
  return <main className="public-page">
    <header className="site-header">
      <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
      <nav className="header-links" aria-label="Main navigation"><Link className="header-note" href="/identify">First-print check</Link><Link className="header-note" href="/browse">Browse manga</Link><Link className="header-note" href="/portfolio">Portfolio -&gt;</Link><ThemeToggle /></nav>
    </header>
    <section className="tool-hero">
      <p className="eyebrow">Missing something?</p>
      <h1>Ask us to add a manga.</h1>
      <p>Spotted one we don&apos;t have? Send it over with the best source you can find. We research every request before it goes in the catalogue — nothing is added on someone&apos;s word alone.</p>
    </section>
    <section className="tool-content"><EditionRequestForm /></section>
  </main>;
}
