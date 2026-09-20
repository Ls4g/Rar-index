import Link from "next/link";
import PriceImportForm from "@/components/PriceImportForm";
import StaffNav from "@/components/StaffNav";

type PriceImportPageProps = { searchParams: Promise<{ report?: string | string[]; editionId?: string | string[] }> };

export default async function PriceImportPage({ searchParams }: PriceImportPageProps) {
  const parameters = await searchParams;
  const reportValue = parameters.report;
  const communityReportId = typeof reportValue === "string" ? reportValue : "";
  const editionIdValue = parameters.editionId;
  const initialEditionId = typeof editionIdValue === "string" ? editionIdValue : "";
  return (
    <main className="review-page catalogue-page price-import-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/coverage-dashboard">Coverage dashboard -&gt;</Link>
        <Link className="header-note" href="/add-sale">Add one sale -&gt;</Link>
        <Link className="header-note" href="/collection-profiles">Collection profiles -&gt;</Link>
        <StaffNav current="/price-import" />
      </header>
      <section className="review-hero catalogue-hero">
        <div>
          <p className="eyebrow">Repeatable price workflow</p>
          <h1>Preflight a sale batch</h1>
          <p>Check a structured sale file before it touches RAR. A batch can contain one edition or many; RAR suggests where each row belongs and records the provenance automatically.</p>
        </div>
      </section>
      <section className="catalogue-content">
        <div className="section-intro">
          <p className="eyebrow">Step 1 - capture safely</p>
          <h2>Validate first, then queue</h2>
          <p className="section-copy">This tool rejects non-sales, ambiguous edition matches and malformed records, detects duplicates, and preserves the submitted source snapshot. It does not scrape a marketplace and it never verifies a price automatically.</p>
        </div>
        <PriceImportForm communityReportId={communityReportId} initialEditionId={initialEditionId} />
        <section className="catalogue-rules" aria-label="Price import rules">
          <div><span>1</span><strong>Supply permitted sale data</strong><p>Use a source export or staff-created file that RAR has permission to reuse.</p></div>
          <div><span>2</span><strong>Let RAR suggest editions</strong><p>Exact ISBNs come first. Close or ambiguous matches are blocked instead of guessed.</p></div>
          <div><span>3</span><strong>Review once</strong><p>Queued observations stay out of valuations until a human approves them in Decisions.</p></div>
        </section>
      </section>
    </main>
  );
}
