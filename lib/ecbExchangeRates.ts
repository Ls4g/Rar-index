import type { SupabaseClient } from "@supabase/supabase-js";

export const ECB_CURRENCIES = ["USD", "GBP", "CAD"] as const;
export const ECB_DATA_URL = "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP+CAD.EUR.SP00.A";
export const EARLIEST_RATE_DATE = "2025-11-10";

export type EcbRateRow = {
  rate_date: string;
  currency: (typeof ECB_CURRENCIES)[number];
  rate_per_eur: number;
  source_name: string;
  source_series: string;
  source_url: string;
  retrieved_at: string;
};

export function parseEcbRatesCsv(csv: string, retrievedAt = new Date().toISOString()): EcbRateRow[] {
  if (!csv.startsWith("KEY,FREQ,CURRENCY,") || !csv.includes("TIME_PERIOD,OBS_VALUE")) {
    throw new Error("ECB returned an unexpected CSV format.");
  }

  const rows = new Map<string, EcbRateRow>();
  for (const line of csv.split(/\r?\n/).slice(1)) {
    // All fields needed for the rate precede the descriptive CSV columns,
    // which can contain quoted commas. Reject anything outside the three
    // specific daily EUR reference series RAR uses.
    const match = line.match(/^EXR\.D\.(USD|GBP|CAD)\.EUR\.SP00\.A,D,\1,EUR,SP00,A,(\d{4}-\d{2}-\d{2}),(\d+(?:\.\d+)?)(?:,|\r?$)/);
    if (!match) continue;
    const currency = match[1] as EcbRateRow["currency"];
    const value = Number(match[3]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const series = `EXR.D.${currency}.EUR.SP00.A`;
    rows.set(`${match[2]}:${currency}`, {
      rate_date: match[2], currency, rate_per_eur: value,
      source_name: "European Central Bank", source_series: series,
      source_url: `https://data-api.ecb.europa.eu/service/data/EXR/D.${currency}.EUR.SP00.A`,
      retrieved_at: retrievedAt,
    });
  }

  const result = [...rows.values()];
  if (ECB_CURRENCIES.some((currency) => !result.some((row) => row.currency === currency))) {
    throw new Error("ECB response did not contain all required currencies.");
  }
  return result;
}

export async function fetchEcbRates(startDate: string, endDate?: string): Promise<EcbRateRow[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate))) {
    throw new Error("ECB rate dates must use YYYY-MM-DD.");
  }
  const url = new URL(ECB_DATA_URL);
  url.searchParams.set("startPeriod", startDate);
  if (endDate) url.searchParams.set("endPeriod", endDate);
  url.searchParams.set("format", "csvdata");
  const response = await fetch(url, { headers: { Accept: "text/csv" }, cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`ECB rate request failed with HTTP ${response.status}.`);
  return parseEcbRatesCsv(await response.text());
}

export async function upsertEcbRates(admin: SupabaseClient, rows: EcbRateRow[]): Promise<number> {
  for (let offset = 0; offset < rows.length; offset += 200) {
    const { error } = await admin.from("exchange_rates").upsert(rows.slice(offset, offset + 200), { onConflict: "rate_date,currency" });
    if (error) throw new Error(`Could not save ECB rates: ${error.message}`);
  }
  return rows.length;
}
