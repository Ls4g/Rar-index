import Link from "next/link";
import CatalogueBulkPanel, { type CatalogueBulkRecord } from "@/components/CatalogueBulkPanel";
import CataloguePhotoButton from "@/components/CataloguePhotoButton";
import CatalogueDecisionForm from "@/components/CatalogueDecisionForm";
import EditionIdentityChecklist from "@/components/EditionIdentityChecklist";
import StaffNav from "@/components/StaffNav";
import { catalogueApprovalProblem, type CatalogueApprovalQueueRow, type KnownCatalogueEdition } from "@/lib/catalogueApprovalGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type CatalogueRecord = {
  id: string;
  external_id: string;
  candidate_kind: "edition_candidate" | "series_reference";
  candidate_title: string;
  candidate_series: string | null;
  candidate_volume_number: string | null;
  candidate_author: string | null;
  candidate_publisher: string | null;
  candidate_language: string | null;
  candidate_isbn_13: string | null;
  candidate_release_date: string | null;
  candidate_format: string | null;
  candidate_cover_image_url: string | null;
  source_name: string | null;
  source_record_url: string;
  raw_payload: {
    human_readable_url?: string | null;
    human_readable_url_label?: string | null;
    marketplace_lookup_url?: string | null;
    marketplace_lookup_alt_url?: string | null;
    listing_photo?: { image_url?: string | null; listing_url?: string | null; listing_title?: string | null; graded?: boolean | null } | null;
    review_metadata?: {
      collectible_type?: string | null;
      magazine_title_id?: string | null;
      issue_year?: string | null;
      issue_number_label?: string | null;
      cumulative_issue_no?: string | null;
      madb_id?: string | null;
    } | null;
    derived_first_appearances?: string[] | null;
    madb?: { cover_price_yen?: number | null; pages?: number | null; note?: string | null } | null;
  } | null;
  imported_at: string;
};

// Some sources have no browsable page for the record they hold. The Media
// Arts Database is one: it renders a full page for a book but nothing at all
// for a magazine issue, so its source link opens onto raw JSON.
//
// Pointing the reviewer somewhere else to hunt did not fix that. The National
// Diet Library holds an exact record for only 1 of the 13 queued issues, and
// a keyword search there returns exhibition catalogues beside the magazine --
// 48 results to answer one question. So the facts that actually decide the
// record are printed on the row, and the link is labelled for what it really
// reaches rather than promising a lookup it cannot do.
function readableSourceUrl(record: CatalogueRecord) {
  const url = record.raw_payload?.human_readable_url;
  return typeof url === "string" && url.length ? url : null;
}

// The only links that show the object rather than describing it. Jump cover
// art is copyrighted, so no bibliographic source publishes it -- but the
// second-hand market is full of photographs of these exact issues.
//
// eBay rather than Yahoo Auctions, which has deeper stock but refuses
// visitors from the EU and UK, making it worthless to the person who has to
// use it. Two searches because sellers write either the Japanese or the
// romanised title and almost never both.
//
// A look, never evidence: nothing is imported from these and no price
// derives from them.
function marketplaceLookupUrl(record: CatalogueRecord) {
  const url = record.raw_payload?.marketplace_lookup_url;
  return typeof url === "string" && url.length ? url : null;
}

function marketplaceLookupAltUrl(record: CatalogueRecord) {
  const url = record.raw_payload?.marketplace_lookup_alt_url;
  return typeof url === "string" && url.length ? url : null;
}

// A photograph of a copy someone is selling, attached by /api/catalogue-photos
// only when the listing's own title names the same year and issue. It exists
// so a magazine can be seen at all -- its cover art is copyrighted and no
// catalogue source carries a picture. It is never a cover and never evidence.
function listingPhoto(record: CatalogueRecord) {
  const photo = record.raw_payload?.listing_photo;
  if (!photo?.image_url) return null;
  return { imageUrl: photo.image_url, listingUrl: photo.listing_url ?? null, listingTitle: photo.listing_title ?? null, graded: photo.graded === true };
}

function sourceFacts(record: CatalogueRecord): string[] {
  const payload = record.raw_payload;
  if (!payload) return [];
  const facts: string[] = [];
  const cumulative = payload.review_metadata?.cumulative_issue_no;
  if (cumulative) facts.push(`通巻 ${cumulative}`);
  if (payload.madb?.cover_price_yen) facts.push(`¥${payload.madb.cover_price_yen} cover`);
  if (payload.madb?.pages) facts.push(`${payload.madb.pages} pages`);
  // The note is free text and carries the binding, plus the zasshi code when
  // the record has one. Only the first clause is short enough to sit in a row.
  const note = payload.madb?.note?.split("／")[0]?.trim();
  if (note) facts.push(note);
  const debuts = payload.derived_first_appearances ?? [];
  if (debuts.length) facts.push(`first appearance: ${debuts.slice(0, 2).join(", ")}${debuts.length > 2 ? ` +${debuts.length - 2}` : ""}`);
  return facts;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

export default async function CatalogueReviewPage() {
  const admin = getSupabaseAdmin();
  const [{ data }, { data: knownEditionData }] = await Promise.all([
    admin
      .from("catalogue_review_queue")
      .select("id, external_id, candidate_kind, candidate_title, candidate_series, candidate_volume_number, candidate_author, candidate_publisher, candidate_language, candidate_isbn_13, candidate_release_date, candidate_format, candidate_cover_image_url, source_name, source_record_url, raw_payload, imported_at")
      .order("imported_at", { ascending: false })
      .limit(50),
    admin.from("manga_editions").select("series,language,publisher").eq("is_verified", true).limit(5000),
  ]);
  const records = (data ?? []) as CatalogueRecord[];
  const knownEditions = (knownEditionData ?? []) as KnownCatalogueEdition[];
  const approvalProblems = new Map(records.map((record) => [record.id, catalogueApprovalProblem(record as unknown as CatalogueApprovalQueueRow, knownEditions)]));
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
    readableUrl: readableSourceUrl(record),
    readableUrlLabel: record.raw_payload?.human_readable_url_label ?? null,
    marketplaceUrl: marketplaceLookupUrl(record),
    marketplaceAltUrl: marketplaceLookupAltUrl(record),
    listingPhoto: listingPhoto(record),
    sourceFacts: sourceFacts(record),
    reviewMetadata: {
      collectibleType: record.raw_payload?.review_metadata?.collectible_type ?? null,
      magazineTitleId: record.raw_payload?.review_metadata?.magazine_title_id ?? null,
      issueYear: record.raw_payload?.review_metadata?.issue_year ?? null,
      issueNumberLabel: record.raw_payload?.review_metadata?.issue_number_label ?? null,
    },
    approvalProblem: approvalProblems.get(record.id) ?? null,
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
        {/* Only magazines need this: a book candidate arrives with a cover
            from its own source, while a magazine's cover art is copyrighted
            and no catalogue source carries a picture at all. */}
        {bulkRecords.some((record) => record.listingPhoto === null && record.sourceFacts.length) ? <CataloguePhotoButton /> : null}
        <CatalogueBulkPanel records={bulkRecords} />
        {records.length ? <div className="review-list">{records.map((record) => (
          <article className="review-card catalogue-card" key={record.id}>
            <div className="review-card-topline"><span>{record.source_name ?? "Catalogue source"} · {record.candidate_kind === "edition_candidate" ? "Edition candidate" : "Series reference"}</span><time>Imported {formatDate(record.imported_at)}</time></div>
            <div className="review-card-main"><div><h3>{record.candidate_title}</h3><p className="review-condition">{[record.candidate_series, record.candidate_volume_number ? `Vol. ${record.candidate_volume_number}` : null, record.candidate_language].filter(Boolean).join(" · ") || "Details still needed"}</p></div><div className="review-source-links">{readableSourceUrl(record) ? <a className="review-source-link" href={readableSourceUrl(record) as string} target="_blank" rel="noreferrer">Look it up ↗</a> : null}<a className="review-source-link is-raw" href={record.source_record_url} target="_blank" rel="noreferrer">{readableSourceUrl(record) ? "Source data ↗" : "Open source record ↗"}</a></div></div>
            {!record.candidate_language ? <p className="catalogue-language-warning" role="status"><strong>Language needs staff confirmation.</strong> The source left this blank, so RAR has not guessed it. Choose Approve new edition and fill the language before publishing.</p> : null}
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
            {approvalProblems.get(record.id) ? <p className="catalogue-approval-conflict" role="alert"><strong>Curator conflict:</strong> {approvalProblems.get(record.id)}</p> : null}
            {record.candidate_kind === "series_reference" ? <div className="review-note"><span>Physical-edition safeguard</span><p>A MangaDex series reference can support research, but it cannot create a physical RAR edition. Link it to an exact existing edition or keep it in review.</p></div> : null}
            <CatalogueDecisionForm
              catalogueImportId={record.id}
              isEditionCandidate={record.candidate_kind === "edition_candidate"}
              candidateTitle={record.candidate_title}
              approvalProblem={approvalProblems.get(record.id) ?? null}
              candidate={{
                title: record.candidate_title,
                series: record.candidate_series,
                volumeNumber: record.candidate_volume_number,
                author: record.candidate_author,
                publisher: record.candidate_publisher,
                language: record.candidate_language,
                isbn13: record.candidate_isbn_13,
                releaseDate: record.candidate_release_date,
                collectibleType: record.raw_payload?.review_metadata?.collectible_type ?? null,
                magazineTitleId: record.raw_payload?.review_metadata?.magazine_title_id ?? null,
                issueYear: record.raw_payload?.review_metadata?.issue_year ?? null,
                issueNumberLabel: record.raw_payload?.review_metadata?.issue_number_label ?? null,
                cumulativeIssueNo: record.raw_payload?.review_metadata?.cumulative_issue_no ?? null,
                madbId: record.raw_payload?.review_metadata?.madb_id ?? null,
              }}
            />
          </article>
        ))}</div> : <div className="review-empty"><strong>The catalogue queue is clear.</strong><p>Use the catalogue importer to bring in the next source candidates.</p></div>}
      </section>
    </main>
  );
}
