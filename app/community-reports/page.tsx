import Link from "next/link";
import CommunityReportDecisionForm from "@/components/CommunityReportDecisionForm";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import StaffNav from "@/components/StaffNav";

export const dynamic = "force-dynamic";

type Report = {
  id: string;
  report_type: "sale" | "pricing_issue" | "edition_issue";
  source_listing_url: string;
  listing_title: string | null;
  reported_price: number | null;
  currency: string | null;
  sold_date: string | null;
  reporter_notes: string;
  status: "pending" | "reviewed" | "rejected" | "converted";
  staff_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  manga_editions: { title: string | null; series: string | null; volume_number: string | number | null; language: string | null } | null;
};

function formatPrice(value: number | null, currency: string | null) {
  if (value === null || !currency) return null;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function typeLabel(value: Report["report_type"]) {
  return value === "sale" ? "Completed sale" : value === "pricing_issue" ? "Pricing issue" : "Edition issue";
}

export default async function CommunityReportsPage() {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("community_sale_reports")
    .select("id,report_type,source_listing_url,listing_title,reported_price,currency,sold_date,reporter_notes,status,staff_notes,reviewed_by,reviewed_at,created_at,manga_editions(title,series,volume_number,language)")
    .order("created_at", { ascending: false })
    .limit(50);
  const reports = (data ?? []) as unknown as Report[];
  const pendingCount = reports.filter((report) => report.status === "pending").length;

  return (
    <main className="review-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <span className="header-note">Internal review</span>
        <StaffNav current="/community-reports" />
      </header>
      <section className="review-hero">
        <div><p className="eyebrow">Community evidence</p><h1>Report review queue</h1><p>Community submissions are leads, not market data. Review the original source before deciding whether to discard it or take it into the normal import process.</p></div>
        <div className="queue-total"><strong>{pendingCount}</strong><span>reports awaiting review</span></div>
      </section>
      <section className="review-list-section">
        <div className="section-intro"><p className="eyebrow">Reported by collectors</p><h2>Check the original evidence</h2><p className="section-copy">Marking a report for import creates no price observation. It preserves the lead for the existing evidence-led import workflow.</p></div>
        {reports.length ? <div className="review-list">{reports.map((report) => {
          const edition = report.manga_editions;
          const editionLabel = [edition?.title, edition?.volume_number ? `Vol. ${edition.volume_number}` : null, edition?.language].filter(Boolean).join(" · ") || "Edition record unavailable";
          const price = formatPrice(report.reported_price, report.currency);
          return <article className="review-card" key={report.id}>
            <div className="review-card-topline"><span>{typeLabel(report.report_type)}</span><time>{formatDate(report.created_at)}</time></div>
            <div className="review-card-main"><div><h3>{report.listing_title ?? "Untitled source"}</h3><strong className="review-price">{price ?? "No price reported"}</strong><p className="review-condition">{[formatDate(report.sold_date), editionLabel].filter(Boolean).join(" · ")}</p></div><a className="review-source-link" href={report.source_listing_url} target="_blank" rel="noreferrer">Open original source ↗</a></div>
            <div className="review-match"><p className="eyebrow">Reported against</p><h4>{editionLabel}</h4><p>{report.reporter_notes}</p></div>
            {report.status === "pending" ? <CommunityReportDecisionForm reportId={report.id} /> : <div className="review-note"><span>{report.status}</span><p>{report.staff_notes ?? "No staff note was recorded."}{report.reviewed_by ? ` — ${report.reviewed_by}` : ""}{report.status === "converted" && report.report_type === "sale" ? <> <Link href={`/price-import?report=${report.id}`}>Open prefilled import handoff →</Link></> : null}</p></div>}
          </article>;
        })}</div> : <div className="review-empty"><strong>No community reports yet.</strong><p>Reports sent from public edition pages will appear here.</p></div>}
      </section>
    </main>
  );
}
