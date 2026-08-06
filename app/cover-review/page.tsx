import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import CoverReviewClient, { type CoverQueueRow } from "@/components/CoverReviewClient";

export const dynamic = "force-dynamic";

type QueueRow = {
  edition_id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  publisher: string | null;
  isbn_13: string | null;
  edition_statement: string | null;
  printing_number: number | null;
  variant_name: string | null;
  collectible_type: string | null;
  cover_image_url: string | null;
  cover_source_url: string | null;
  cover_source_name: string | null;
  cover_verification_status: CoverQueueRow["coverStatus"];
  cover_verified_at: string | null;
  printing_of_edition_id: string | null;
  verified_sale_count: number;
};

type EditionRow = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  publisher: string | null;
  isbn_13: string | null;
  edition_statement: string | null;
  printing_number: number | null;
  variant_name: string | null;
  collectible_type: string | null;
  cover_image_url: string | null;
  cover_source_url: string | null;
  cover_source_name: string | null;
  cover_verification_status: CoverQueueRow["coverStatus"];
  cover_verified_at: string | null;
  printing_of_edition_id: string | null;
};

function mapQueueRow(row: QueueRow): CoverQueueRow {
  return {
    editionId: row.edition_id,
    title: row.title,
    series: row.series,
    volumeNumber: row.volume_number,
    language: row.language,
    publisher: row.publisher,
    isbn13: row.isbn_13,
    editionStatement: row.edition_statement,
    printingNumber: row.printing_number,
    variantName: row.variant_name,
    collectibleType: row.collectible_type,
    coverImageUrl: row.cover_image_url,
    coverSourceUrl: row.cover_source_url,
    coverSourceName: row.cover_source_name,
    coverStatus: row.cover_verification_status ?? "missing",
    coverVerifiedAt: row.cover_verified_at,
    printingOfEditionId: row.printing_of_edition_id,
    verifiedSaleCount: row.verified_sale_count,
  };
}

export default async function CoverReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ edition?: string }>;
}) {
  const { edition: focusedEditionId } = await searchParams;
  const admin = getSupabaseAdmin();

  const [{ data: queueData }, focusedEditionResult, focusedSaleCountResult] = await Promise.all([
    admin
      .from("cover_review_queue")
      .select("edition_id,title,series,volume_number,language,publisher,isbn_13,edition_statement,printing_number,variant_name,collectible_type,cover_image_url,cover_source_url,cover_source_name,cover_verification_status,cover_verified_at,printing_of_edition_id,verified_sale_count")
      .order("verified_sale_count", { ascending: false })
      .order("series", { ascending: true })
      .order("volume_number", { ascending: true }),
    focusedEditionId
      ? admin
        .from("manga_editions")
        .select("id,title,series,volume_number,language,publisher,isbn_13,edition_statement,printing_number,variant_name,collectible_type,cover_image_url,cover_source_url,cover_source_name,cover_verification_status,cover_verified_at,printing_of_edition_id")
        .eq("id", focusedEditionId)
        .maybeSingle()
      : Promise.resolve({ data: null }),
    focusedEditionId
      ? admin
        .from("price_observations")
        .select("id", { count: "exact", head: true })
        .eq("edition_id", focusedEditionId)
        .eq("match_status", "verified_match")
        .eq("sale_status", "confirmed")
      : Promise.resolve({ count: 0 }),
  ]);

  const queueRows = ((queueData ?? []) as QueueRow[]).map(mapQueueRow);
  const focusedEdition = focusedEditionResult.data as EditionRow | null;
  const focusedRow: CoverQueueRow | null = focusedEdition
    ? mapQueueRow({
      edition_id: focusedEdition.id,
      title: focusedEdition.title,
      series: focusedEdition.series,
      volume_number: focusedEdition.volume_number,
      language: focusedEdition.language,
      publisher: focusedEdition.publisher,
      isbn_13: focusedEdition.isbn_13,
      edition_statement: focusedEdition.edition_statement,
      printing_number: focusedEdition.printing_number,
      variant_name: focusedEdition.variant_name,
      collectible_type: focusedEdition.collectible_type,
      cover_image_url: focusedEdition.cover_image_url,
      cover_source_url: focusedEdition.cover_source_url,
      cover_source_name: focusedEdition.cover_source_name,
      cover_verification_status: focusedEdition.cover_verification_status ?? "missing",
      cover_verified_at: focusedEdition.cover_verified_at,
      printing_of_edition_id: focusedEdition.printing_of_edition_id,
      verified_sale_count: focusedSaleCountResult.count ?? 0,
    })
    : null;

  return (
    <main className="review-page catalogue-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/coverage-dashboard">Coverage dashboard -&gt;</Link>
        <Link className="header-note" href="/catalogue-review">Catalogue review -&gt;</Link>
        <Link className="header-note" href="/data-readiness">Data readiness -&gt;</Link>
      </header>
      <section className="review-hero catalogue-hero">
        <div>
          <p className="eyebrow">Repeatable cover sourcing</p>
          <h1>Cover review</h1>
          <p>Source, record, and publish exact-edition cover art. A cover only shows publicly once it is verified against a publisher or licensed catalogue record — candidates and rejections stay staff-only, and every decision is kept in an audit trail.</p>
        </div>
        <div className="queue-total"><strong>{queueRows.length}</strong><span>editions without a verified cover</span></div>
      </section>
      <section className="catalogue-content">
        <CoverReviewClient rows={queueRows} focusedRow={focusedRow} />
      </section>
    </main>
  );
}
