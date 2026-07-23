import Link from "next/link";
import CatalogueDecisionForm from "@/components/CatalogueDecisionForm";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type CatalogueRecord = {
  id: string;
  candidate_kind: "edition_candidate" | "series_reference";
  candidate_title: string;
  candidate_series: string | null;
  candidate_volume_number: string | null;
  candidate_author: string | null;
  candidate_publisher: string | null;
  candidate_language: string | null;
  candidate_isbn_13: string | null;
  candidate_release_date: string | null;
  source_name: string | null;
  source_record_url: string;
  imported_at: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

export default async function CatalogueReviewPage() {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("catalogue_review_queue")
    .select("id, candidate_kind, candidate_title, candidate_series, candidate_volume_number, candidate_author, candidate_publisher, candidate_language, candidate_isbn_13, candidate_release_date, source_name, source_record_url, imported_at")
    .order("imported_at", { ascending: false })
    .limit(50);
  const records = (data ?? []) as CatalogueRecord[];

  return (
    <main className="review-page catalogue-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/catalogue-import">Import candidates →</Link>
      </header>
      <section className="review-hero catalogue-hero">
        <div>
          <p className="eyebrow">Human verification layer</p>
          <h1>Catalogue review queue</h1>
          <p>Every candidate keeps its source record. No catalogue import becomes a verified physical edition without an accountable decision.</p>
        </div>
        <div className="queue-total"><strong>{records.length}</strong><span>candidates awaiting review</span></div>
      </section>
      <section className="review-list-section">
        {records.length ? <div className="review-list">{records.map((record) => (
          <article className="review-card catalogue-card" key={record.id}>
            <div className="review-card-topline"><span>{record.source_name ?? "Catalogue source"} · {record.candidate_kind === "edition_candidate" ? "Edition candidate" : "Series reference"}</span><time>Imported {formatDate(record.imported_at)}</time></div>
            <div className="review-card-main"><div><h3>{record.candidate_title}</h3><p className="review-condition">{[record.candidate_series, record.candidate_volume_number ? `Vol. ${record.candidate_volume_number}` : null, record.candidate_language].filter(Boolean).join(" · ") || "Details still needed"}</p></div><a className="review-source-link" href={record.source_record_url} target="_blank" rel="noreferrer">Open source record ↗</a></div>
            <dl className="catalogue-details">
              {record.candidate_author ? <div><dt>Author</dt><dd>{record.candidate_author}</dd></div> : null}
              {record.candidate_publisher ? <div><dt>Publisher</dt><dd>{record.candidate_publisher}</dd></div> : null}
              {record.candidate_isbn_13 ? <div><dt>ISBN-13</dt><dd>{record.candidate_isbn_13}</dd></div> : null}
              {record.candidate_release_date ? <div><dt>Release date</dt><dd>{record.candidate_release_date}</dd></div> : null}
            </dl>
            {record.candidate_kind === "series_reference" ? <div className="review-note"><span>Physical-edition safeguard</span><p>A MangaDex series reference can support research, but it cannot create a physical RAR edition. Link it to an exact existing edition or keep it in review.</p></div> : null}
            <CatalogueDecisionForm catalogueImportId={record.id} isEditionCandidate={record.candidate_kind === "edition_candidate"} />
          </article>
        ))}</div> : <div className="review-empty"><strong>The catalogue queue is clear.</strong><p>Use the catalogue importer to bring in the next source candidates.</p></div>}
      </section>
    </main>
  );
}
