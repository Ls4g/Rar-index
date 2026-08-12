import Link from "next/link";
import CatalogueBulkPanel, { type CatalogueBulkRecord } from "@/components/CatalogueBulkPanel";
import CatalogueDecisionForm from "@/components/CatalogueDecisionForm";
import EditionIdentityChecklist from "@/components/EditionIdentityChecklist";
import StaffNav from "@/components/StaffNav";
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
  raw_payload: { human_readable_url?: string | null } | null;
  imported_at: string;
};

// Some sources have no browsable page for the record they hold. The Media
// Arts Database is one: it renders a full page for a book but nothing at all
// for a magazine issue, so RAR stores its query endpoint as the source record
// and a second, readable link to check the claim against. Where that exists,
// the reviewer gets both -- a source link that opens onto raw data is not
// much use for deciding whether a record is right.
function readableSourceUrl(record: CatalogueRecord) {
  const url = record.raw_payload?.human_readable_url;
  return typeof url === "string" && url.length ? url : null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

export default async function CatalogueReviewPage() {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("catalogue_review_queue")
    .select("id, candidate_kind, candidate_title, candidate_series, candidate_volume_number, candidate_author, candidate_publisher, candidate_language, candidate_isbn_13, candidate_release_date, source_name, source_record_url, raw_payload, imported_at")
    .order("imported_at", { ascending: false })
    .limit(50);
  const records = (data ?? []) as CatalogueRecord[];
  const bulkRecords: CatalogueBulkRecord[] = records.map((record) => ({
    id: record.id,
    kind: record.candidate_kind,
    title: record.candidate_title,
    series: record.candidate_series,
    volumeNumber: record.candidate_volume_number,
    publisher: record.candidate_publisher,
    language: record.candidate_language,
    isbn13: record.candidate_isbn_13,
    releaseDate: record.candidate_release_date,
    sourceName: record.source_name,
    sourceRecordUrl: record.source_record_url,
  }));

  return (
    <main className="review-page catalogue-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/catalogue-import">Import candidates →</Link>
        <Link className="header-note" href="/coverage-dashboard">Coverage dashboard →</Link>
        <Link className="header-note" href="/cover-review">Cover review →</Link>
        <StaffNav current="/catalogue-review" />
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
        <CatalogueBulkPanel records={bulkRecords} />
        {records.length ? <div className="review-list">{records.map((record) => (
          <article className="review-card catalogue-card" key={record.id}>
            <div className="review-card-topline"><span>{record.source_name ?? "Catalogue source"} · {record.candidate_kind === "edition_candidate" ? "Edition candidate" : "Series reference"}</span><time>Imported {formatDate(record.imported_at)}</time></div>
            <div className="review-card-main"><div><h3>{record.candidate_title}</h3><p className="review-condition">{[record.candidate_series, record.candidate_volume_number ? `Vol. ${record.candidate_volume_number}` : null, record.candidate_language].filter(Boolean).join(" · ") || "Details still needed"}</p></div><div className="review-source-links">{readableSourceUrl(record) ? <a className="review-source-link" href={readableSourceUrl(record) as string} target="_blank" rel="noreferrer">Look it up ↗</a> : null}<a className="review-source-link is-raw" href={record.source_record_url} target="_blank" rel="noreferrer">{readableSourceUrl(record) ? "Source data ↗" : "Open source record ↗"}</a></div></div>
            <dl className="catalogue-details">
              {record.candidate_author ? <div><dt>Author</dt><dd>{record.candidate_author}</dd></div> : null}
              {record.candidate_publisher ? <div><dt>Publisher</dt><dd>{record.candidate_publisher}</dd></div> : null}
              {record.candidate_isbn_13 ? <div><dt>ISBN-13</dt><dd>{record.candidate_isbn_13}</dd></div> : null}
              {record.candidate_release_date ? <div><dt>Release date</dt><dd>{record.candidate_release_date}</dd></div> : null}
            </dl>
            <EditionIdentityChecklist
              isEditionCandidate={record.candidate_kind === "edition_candidate"}
              candidate={{ title: record.candidate_title, language: record.candidate_language, isbn13: record.candidate_isbn_13, publisher: record.candidate_publisher, releaseDate: record.candidate_release_date }}
            />
            {record.candidate_kind === "series_reference" ? <div className="review-note"><span>Physical-edition safeguard</span><p>A MangaDex series reference can support research, but it cannot create a physical RAR edition. Link it to an exact existing edition or keep it in review.</p></div> : null}
            <CatalogueDecisionForm
              catalogueImportId={record.id}
              isEditionCandidate={record.candidate_kind === "edition_candidate"}
              candidateTitle={record.candidate_title}
              candidate={{
                title: record.candidate_title,
                series: record.candidate_series,
                volumeNumber: record.candidate_volume_number,
                author: record.candidate_author,
                publisher: record.candidate_publisher,
                language: record.candidate_language,
                isbn13: record.candidate_isbn_13,
                releaseDate: record.candidate_release_date,
              }}
            />
          </article>
        ))}</div> : <div className="review-empty"><strong>The catalogue queue is clear.</strong><p>Use the catalogue importer to bring in the next source candidates.</p></div>}
      </section>
    </main>
  );
}
