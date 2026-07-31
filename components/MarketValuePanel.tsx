"use client";

import { comparisonGroup, convertSale, DISPLAY_CURRENCIES, formatPrice, median, type FxRate, type MarketSale } from "@/lib/fx";
import { useMarketCurrency } from "@/components/MarketCurrencyProvider";

type MarketValuePanelProps = {
  sales: MarketSale[];
  rates: FxRate[];
};

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

export default function MarketValuePanel({ sales, rates }: MarketValuePanelProps) {
  const { currency, setCurrency } = useMarketCurrency();
  const groups = new Map<string, { label: string; sales: ReturnType<typeof convertSale>[] }>();

  for (const sale of sales) {
    const converted = convertSale(sale, currency, rates);
    if (!converted) continue;
    const group = comparisonGroup(sale);
    const existing = groups.get(group.key) ?? { label: group.grading, sales: [] };
    existing.sales.push(converted);
    groups.set(group.key, existing);
  }

  const marketGroups = [...groups.values()]
    .map((group) => ({ ...group, sales: group.sales.filter((sale): sale is NonNullable<typeof sale> => Boolean(sale)) }))
    .filter((group) => group.sales.length)
    .sort((a, b) => b.sales.length - a.sales.length);

  return (
    <>
      <div className="market-currency-control">
        <label htmlFor="market-currency">Display currency</label>
        <select id="market-currency" value={currency} onChange={(event) => setCurrency(event.target.value as typeof currency)}>
          {DISPLAY_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
      </div>
      {marketGroups.length ? (
        <div className="metric-stack">
          {marketGroups.map((group) => {
            const values = group.sales.map((sale) => sale.converted_price);
            const latest = [...group.sales].sort((a, b) => (b.sold_date ?? "").localeCompare(a.sold_date ?? ""))[0];
            const value = median(values);
            return (
              <div className="metric-card" key={group.label}>
                <span className="metric-label">Median · {currency} · {group.label}</span>
                <strong>{value === null ? "—" : formatPrice(value, currency)}</strong>
                <dl>
                  <div><dt>Verified sales</dt><dd>{group.sales.length}</dd></div>
                  <div><dt>Highest</dt><dd>{formatPrice(Math.max(...values), currency)}</dd></div>
                  <div><dt>Latest sale</dt><dd>{formatDate(latest?.sold_date ?? null)}</dd></div>
                </dl>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-valuation">
          <strong>Price data is being verified.</strong>
          <p>RAR will show a market value once it has verified sales and a historical exchange rate for each sale date.</p>
        </div>
      )}
    </>
  );
}
