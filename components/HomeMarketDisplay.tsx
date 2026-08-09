"use client";

import { useId } from "react";
import { convertSale, DISPLAY_CURRENCIES, formatPrice, type FxRate } from "@/lib/fx";
import { useMarketCurrency } from "@/components/MarketCurrencyProvider";

type HomePriceProps = {
  value: number;
  sourceCurrency: string;
  rateDate: string | null;
  rates: FxRate[];
};

/**
 * Homepage figures follow one visitor-selected display currency. The source
 * amount stays unchanged and remains available in a hover title.
 */
export function HomePrice({ value, sourceCurrency, rateDate, rates }: HomePriceProps) {
  const { currency } = useMarketCurrency();
  const converted = convertSale({
    sale_price: value,
    currency: sourceCurrency,
    sold_date: rateDate,
    grading_company: null,
    grade_label: null,
  }, currency, rates);
  const original = formatPrice(value, sourceCurrency);
  const display = converted ? formatPrice(converted.converted_price, currency) : original;

  return <span title={converted && sourceCurrency !== currency ? `Original amount: ${original}` : undefined}>{display}</span>;
}

export function HomeMarketCurrencyControl() {
  const { currency, setCurrency } = useMarketCurrency();
  const id = useId();

  return (
    <label className="home-market-currency-control" htmlFor={id}>
      <span>Prices</span>
      <select id={id} value={currency} onChange={(event) => setCurrency(event.target.value as typeof currency)}>
        {DISPLAY_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
      </select>
    </label>
  );
}
