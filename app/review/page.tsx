import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import ReviewDecisionForm from "@/components/ReviewDecisionForm";
import PrintClassificationQueue from "@/components/PrintClassificationQueue";
import StaffNav from "@/components/StaffNav";

// This is an operational queue: newly imported sales must appear immediately.
export const dynamic = "force-dynamic";

type ReviewRecord = {
  observation_id: string;
  match_status: "verified_match" | "needs_review" | "excluded";
  listing_title: string | null;
  source_listing_url: string | null;
  sold_date: string | null;
  sale_price: number | null;
  currency: string | null;
  match_notes: string | null;
  queued_at: string | null;
  edition_id: string | null;
  edition_title: string | null;
  edition_series: string | null;
  edition_volume_number: string | null;
  edition_language: string | null;
  edition_isbn_13: string | null;
  edition_statement: string | null;
  printing_number: number | null;
  source_name: string | null;
  evidence_image_url: string | null;
  print_classification: "printing_not_identified" | "known_later_print" | "first_print_proven";
  printing_proof_url: string | null;
  known_printing_number: number | null;
};

type ClassificationQueueRecord = {
  observation_id: string;
  edition_id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  publisher: string | null;
  listing_title: string | null;
  source_listing_url: string | null;
  sold_date: string | null;
  sale_price: number | null;
  currency: string | null;
  print_classification: "printing_not_identified" | "known_later_print" | "first_print_proven";
  has_unreviewed_evidence_hint: boolean;
};

function formatPrice(value: number | null, currency: string | null) {
  if (value === null || !currency) return "Price not recorded";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "Date not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

export default async function ReviewQueuePage() {
  const { data } = await supabase
    .from("price_review_queue")
    .select("*")
    .eq("match_status", "needs_review")
    .order("queued_at", { ascending: false })
    .limit(50);

  const baseRecords = (data ?? []) as Omit<ReviewRecord, "print_classification" | "printing_proof_url" | "known_printing_number">[];
  const admin = getSupabaseAdmin();
  const observationIds = baseRecords.map((record) => record.observation_id);
  const { data: classificationData } = observationIds.length
    ? await admin.from("price_observations").select("id,print_classification,printing_proof_url,known_printing_number").in("id", observationIds)
    : { data: [] };
  const classificationById = new Map((classificationData ?? []).map((row) => [row.id, row]));
  const records: ReviewRecord[] = baseRecords.map((record) => {
    const classification = classificationById.get(record.observation_id);
    return {
      ...record,
      print_classification: classification?.print_classification ?? "printing_not_identified",
      printing_proof_url: classification?.printing_proof_url ?? null,
      known_printing_number: classification?.known_printing_number ?? null,
    };
  });

  // Sales that already matched their exact edition but still sit at the
  // honest default — the print-classification backlog, prioritised toward
  // rows whose listing title reads as a first-print claim or which already
  // captured an image nobody has reviewed for printing proof yet.
  const { data: classificationQueueData } = await admin
    .from("print_classification_queue")
    .select("*")
    .limit(30);
  const classificationQueue = (classificationQueueData ?? []) as ClassificationQueueRecord[];

  return (
    <main className="review-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home">
          <span className="brand-mark">R</span>
          <span>RAR</span>
          <em>Index</em>
        </Link>
        <Link className="header-note" href="/coverage-dashboard">Coverage dashboard -&gt;</Link>
        <Link className="header-note" href="/add-sale">Add one sale -&gt;</Link>
        <span className="header-note">Internal review</span>
        <StaffNav current="/review" />
      </header>

      <section className="review-hero">
        <div>
          <p className="eyebrow">Repeatable price workflow</p>
          <h1>Price review queue</h1>
          <p>Only exact-edition matches become market data. Everything else stays here until the evidence is strong enough.</p>
        </div>
        <div className="queue-total">
          <strong>{records.length}</strong>
          <span>records awaiting review</span>
        </div>
      </section>

      <section className="review-steps" aria-label="Price review process">
        <div><span>1</span><strong>Capture</strong><p>Save the completed listing and its sale details.</p></div>
        <div><span>2</span><strong>Match</strong><p>Compare language, ISBN, printing and variant to one edition.</p></div>
        <div><span>3</span><strong>Decide</strong><p>Verify, keep under review, or exclude with a note.</p></div>
        <div><span>4</span><strong>Publish</strong><p>Only verified matches feed market value and price history.</p></div>
      </section>

      <section className="review-list-section">
        <div className="section-intro">
          <p className="eyebrow">Evidence awaiting a decision</p>
          <h2>Match each sale to an edition</h2>
          <p className="section-copy">Use the original listing as the source of truth. A similar title is never enough on its own.</p>
        </div>

        {records.length ? (
          <div className="review-list">
            {records.map((record) => (
              <article className="review-card" key={record.observation_id}>
                <div className="review-card-topline">
                  <span>{record.source_name ?? "Marketplace sale"}</span>
                  <time>{formatDate(record.sold_date)}</time>
                </div>
                <div className="review-card-main">
                  <div>
                    <h3>{record.listing_title ?? "Untitled marketplace listing"}</h3>
                    <strong className="review-price">{formatPrice(record.sale_price, record.currency)}</strong>
                  </div>
                  {record.source_listing_url ? (
                    <a className="review-source-link" href={record.source_listing_url} target="_blank" rel="noreferrer">Open original listing ↗</a>
                  ) : null}
                  {record.evidence_image_url ? (
                    <a className="review-source-link" href={record.evidence_image_url} target="_blank" rel="noreferrer">Open copyright-page proof ↗</a>
                  ) : null}
                </div>
                <div className="review-match">
                  <p className="eyebrow">Proposed edition</p>
                  <h4>{record.edition_title ?? "No edition linked yet"}</h4>
                  <p>
                    {[record.edition_series, record.edition_volume_number ? `Vol. ${record.edition_volume_number}` : null, record.edition_language]
                      .filter(Boolean)
                      .join(" · ") || "Edition details still needed"}
                  </p>
                  <dl>
                    {record.edition_isbn_13 ? <div><dt>ISBN</dt><dd>{record.edition_isbn_13}</dd></div> : null}
                    {record.printing_number ? <div><dt>Printing</dt><dd>{record.printing_number}</dd></div> : null}
                    {record.edition_statement ? <div><dt>Edition</dt><dd>{record.edition_statement}</dd></div> : null}
                  </dl>
                </div>
                <div className="review-note">
                  <span>Why it needs review</span>
                  <p>{record.match_notes ?? "Check the listing images, copyright-page proof and edition identifiers before verifying."}</p>
                </div>
                <ReviewDecisionForm observationId={record.observation_id} />
              </article>
            ))}
          </div>
        ) : (
          <div className="review-empty">
            <strong>The queue is clear.</strong>
            <p>New candidate sales will appear here before they can affect the RAR Index.</p>
          </div>
        )}
      </section>

      <section className="review-list-section">
        <div className="section-intro">
          <p className="eyebrow">Optional proof follow-up</p>
          <h2>Copyright proof supplied</h2>
          <p className="section-copy">Only sales with a direct copyright-page image you already captured appear here. A listing title claiming “first print” never creates extra work by itself. Every other matched sale can remain honestly “printing not identified”.</p>
        </div>

        {classificationQueue.length ? (
          <PrintClassificationQueue
            records={classificationQueue.map((record) => ({
              observation_id: record.observation_id,
              edition_id: record.edition_id,
              title: record.title,
              series: record.series,
              volume_number: record.volume_number,
              language: record.language,
              publisher: record.publisher,
              listing_title: record.listing_title,
              source_listing_url: record.source_listing_url,
              sold_date: record.sold_date,
              sale_price: record.sale_price ?? 0,
              currency: record.currency ?? "USD",
              has_unreviewed_evidence_hint: record.has_unreviewed_evidence_hint,
            }))}
          />
        ) : (
          <div className="review-empty">
            <strong>No copyright proof waiting to be classified.</strong>
            <p>Verified sales without direct printing proof remain usable as “printing not identified” records and need no further action.</p>
          </div>
        )}
      </section>
    </main>
  );
}
