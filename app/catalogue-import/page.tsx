import Link from "next/link";
import CatalogueImportForm from "@/components/CatalogueImportForm";
import StaffNav from "@/components/StaffNav";

export default function CatalogueImportPage() {
  return (
    <main className="review-page catalogue-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/catalogue-review">Catalogue review queue →</Link>
        <Link className="header-note" href="/coverage-dashboard">Coverage dashboard →</Link>
        <StaffNav current="/catalogue-import" />
      </header>
      <section className="review-hero catalogue-hero">
        <div>
          <p className="eyebrow">Repeatable catalogue workflow</p>
          <h1>Find catalogue candidates</h1>
          <p>Search a source, preserve its original record, then review it before it can become a trusted RAR edition.</p>
        </div>
      </section>
      <section className="catalogue-content">
        <div className="section-intro">
          <p className="eyebrow">Step 1 — capture</p>
          <h2>Bring candidates into RAR safely</h2>
          <p className="section-copy">Shueisha Direct is the preferred starting point for Shueisha manga. National Diet Library records provide an independent Japanese bibliography cross-check. Open Library can suggest edition leads; MangaDex is work-level only.</p>
        </div>
        <CatalogueImportForm />
        <section className="catalogue-rules" aria-label="Catalogue import rules">
          <div><span>1</span><strong>Preserve source evidence</strong><p>RAR stores the source URL and source payload with every candidate.</p></div>
          <div><span>2</span><strong>Verify the exact edition</strong><p>ISBN, language, publisher, date and format remain human checks.</p></div>
          <div><span>3</span><strong>Only then price it</strong><p>Market observations can be matched only after an edition is trustworthy.</p></div>
        </section>
      </section>
    </main>
  );
}
