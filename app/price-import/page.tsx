import Link from "next/link";
import PriceImportForm from "@/components/PriceImportForm";

export default function PriceImportPage() {
  return (
    <main className="review-page catalogue-page price-import-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/review">Price review queue -&gt;</Link>
      </header>
      <section className="review-hero catalogue-hero">
        <div>
          <p className="eyebrow">Repeatable price workflow</p>
          <h1>Preflight a sale batch</h1>
          <p>Check a structured CSV before it touches RAR. Only confirmed sales for one selected edition enter the review queue.</p>
        </div>
      </section>
      <section className="catalogue-content">
        <div className="section-intro">
          <p className="eyebrow">Step 1 - capture safely</p>
          <h2>Validate first, then queue</h2>
          <p className="section-copy">This tool rejects non-sales and malformed records, detects duplicates, and preserves the original listing snapshot. It never verifies a price automatically.</p>
        </div>
        <PriceImportForm />
        <section className="catalogue-rules" aria-label="Price import rules">
          <div><span>1</span><strong>Choose one exact edition</strong><p>A CSV batch always links to one verified RAR edition; a similar title is not enough.</p></div>
          <div><span>2</span><strong>Run preflight</strong><p>Fix blocked rows and remove any doubt before creating candidates.</p></div>
          <div><span>3</span><strong>Review the evidence</strong><p>Queued sales stay out of valuations until a human verifies the edition match.</p></div>
        </section>
      </section>
    </main>
  );
}
