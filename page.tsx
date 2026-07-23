import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";

type EditionPageProps = {
  params: Promise<{ id: string }>;
};

type SourceLink = {
  source_id: string;
  source_record_url: string;
  verification_notes: string | null;
  fields_verified: string[] | null;
};

type Source = { id: string; name: string };

type ObservedSale = {
  source_id: string | null;
  source_listing_url: string | null;
  listing_title: string | null;
  sold_date: string | null;
  sale_price: number;
  currency: string;
  item_condition: string | null;
  match_status: "verified_match" | "needs_review" | "excluded";
};

type Metric = {
  currency: string;
  verified_sale_count: number;
  lowest_verified_sale: number;
  market_value_median: number;
  highest_verified_sale: number;
  latest_sale_date: string;
};

function formatPrice(value: number, code: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: code,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function matchStatusLabel(status: ObservedSale["match_status"]) {
  return status === "verified_match" ? "Edition match verified" : "Edition match under review";
}

export default async function EditionPage({ params }: EditionPageProps) {
  const { id } = await params;
  const { data: edition } = await supabase
    .from("manga_editions")
    .select(
      "id, title, series, volume_number, author, publisher, imprint, language, country, isbn_10, isbn_13, release_date, format, edition_statement, printing_number, variant_name, historical_notes, importance_tags, is_verified"
    )
    .eq("id", id)
    .maybeSingle();

  if (!edition) notFound();

  const [metricsResult, sourceLinksResult, observedSalesResult] = await Promise.all([
    supabase
      .from("edition_market_metrics")
      .select("currency, verified_sale_count, lowest_verified_sale, market_value_median, highest_verified_sale, latest_sale_date")
      .eq("edition_id", id),
    supabase
      .from("edition_sources")
      .select("source_id, source_record_url, verification_notes, fields_verified")
      .eq("edition_id", id)
      .order("is_primary", { ascending: false }),
    supabase
      .from("price_observations")
      .select("source_id, source_listing_url, listing_title, sold_date, sale_price, currency, item_condition, match_status")
      .eq("edition_id", id)
      .eq("sale_status", "confirmed")
      .neq("match_status", "excluded")
      .order("sold_date", { ascending: false })
      .limit(5),
  ]);

  const sourceLinks = (sourceLinksResult.data ?? []) as SourceLink[];
  const observedSales = (observedSalesResult.data ?? []) as ObservedSale[];
  const sourceIds = [
    ...new Set([
      ...sourceLinks.map((source) => source.source_id),
      ...observedSales.map((sale) => sale.source_id).filter((id): id is string => Boolean(id)),
    ]),
  ];
  const sourcesResult = sourceIds.length
    ? await supabase.from("sources").select("id, name").in("id", sourceIds)
    : { data: [] as Source[] };
  const sourceNames = new Map((sourcesResult.data ?? []).map((source) => [source.id, source.name]));
  const metrics = (metricsResult.data ?? []) as Metric[];

  const details = [
    ["Series", edition.series],
    ["Volume", edition.volume_number ? `Vol. ${edition.volume_number}` : null],
    ["Language", edition.language],
    ["Country", edition.country],
    ["Author", edition.author],
    ["Publisher", edition.publisher],
    ["Imprint", edition.imprint],
    ["Format", edition.format],
    ["Release date", formatDate(edition.release_date)],
    ["ISBN-13", edition.isbn_13],
    ["ISBN-10", edition.isbn_10],
    ["Edition", edition.edition_statement],
    ["Printing", edition.printing_number ? `${edition.printing_number}${edition.printing_number === 1 ? "st" : "th"} printing` : null],
  ].filter(([, value]) => value) as Array<[string, string]>;

  return (
    <main>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home">
          <span className="brand-mark">R</span>
          <span>RAR</span>
          <em>Index</em>
        </Link>
        <span className="header-note">Edition record</span>
      </header>

      <section className="edition-hero">
        <div className="edition-hero-inner">
          <Link href="/" className="back-link">← Back to the index</Link>
          <p className="eyebrow">Verified manga edition</p>
          <h1>{edition.title}</h1>
          <p className="edition-subtitle">
            {[edition.series, edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {edition.variant_name || edition.edition_statement ? (
            <p className="edition-variant">{edition.variant_name || edition.edition_statement}</p>
          ) : null}
        </div>
      </section>

      <section className="edition-content">
        <div className="edition-layout">
          <div>
            <div className="section-intro">
              <p className="eyebrow">Catalogue record</p>
              <h2>Edition details</h2>
            </div>
            <dl className="edition-details">
              {details.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>

            {edition.historical_notes ? (
              <div className="record-note">
                <p className="eyebrow">Collector note</p>
                <p>{edition.historical_notes}</p>
              </div>
            ) : null}

            {edition.importance_tags?.length ? (
              <div className="tag-list" aria-label="Edition tags">
                {edition.importance_tags.map((tag: string) => (
                  <span key={tag}>{tag.replaceAll("_", " ")}</span>
                ))}
              </div>
            ) : null}
          </div>

          <aside className="valuation-panel">
            <p className="eyebrow">RAR market value</p>
            {metrics.length ? (
              <div className="metric-stack">
                {metrics.map((metric) => (
                  <div className="metric-card" key={metric.currency}>
                    <span className="metric-label">Median · {metric.currency}</span>
                    <strong>{formatPrice(metric.market_value_median, metric.currency)}</strong>
                    <dl>
                      <div><dt>Verified sales</dt><dd>{metric.verified_sale_count}</dd></div>
                      <div><dt>Highest</dt><dd>{formatPrice(metric.highest_verified_sale, metric.currency)}</dd></div>
                      <div><dt>Latest sale</dt><dd>{formatDate(metric.latest_sale_date)}</dd></div>
                    </dl>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-valuation">
                <strong>Price data is being verified.</strong>
                <p>RAR will show a market value only after it has sales proven to match this exact edition.</p>
              </div>
            )}
          </aside>
        </div>

        <section className="observed-sales-section">
          <div className="section-intro">
            <p className="eyebrow">Recent market evidence</p>
            <h2>Confirmed sales</h2>
            <p className="section-copy">
              These are completed marketplace sales. RAR only uses a sale in the market value once the listing is proven to match this exact edition.
            </p>
          </div>
          {observedSales.length ? (
            <div className="observed-sales-list">
              {observedSales.map((sale) => {
                const content = (
                  <>
                    <div>
                      <span className="sale-source">{sale.source_id ? sourceNames.get(sale.source_id) ?? "Marketplace sale" : "Marketplace sale"}</span>
                      <strong>{formatPrice(sale.sale_price, sale.currency)}</strong>
                      <small>{formatDate(sale.sold_date)}{sale.item_condition ? ` · ${sale.item_condition} condition` : ""}</small>
                    </div>
                    <span className={`sale-status ${sale.match_status}`}>{matchStatusLabel(sale.match_status)}</span>
                  </>
                );

                return sale.source_listing_url ? (
                  <a className="observed-sale" href={sale.source_listing_url} target="_blank" rel="noreferrer" key={sale.source_listing_url}>
                    {content}
                  </a>
                ) : (
                  <div className="observed-sale" key={`${sale.sold_date}-${sale.sale_price}`}>
                    {content}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="status-message">No completed sales have been recorded for this edition yet.</p>
          )}
        </section>

        <section className="sources-section">
          <div className="section-intro">
            <p className="eyebrow">Provenance</p>
            <h2>Catalogue sources</h2>
          </div>
          {sourceLinks.length ? (
            <div className="source-list">
              {sourceLinks.map((source) => (
                <a className="source-card" href={source.source_record_url} target="_blank" rel="noreferrer" key={source.source_record_url}>
                  <span>{sourceNames.get(source.source_id) ?? "Catalogue source"}</span>
                  <strong>View original record ↗</strong>
                  {source.verification_notes ? <small>{source.verification_notes}</small> : null}
                </a>
              ))}
            </div>
          ) : (
            <p className="status-message">Source evidence will be attached as this edition is verified.</p>
          )}
        </section>
      </section>
    </main>
  );
}
