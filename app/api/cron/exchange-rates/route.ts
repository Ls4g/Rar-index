import { EARLIEST_RATE_DATE, ECB_CURRENCIES, fetchEcbRates, upsertEcbRates } from "@/lib/ecbExchangeRates";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized cron request." }, { status: 401 });
  }

  try {
    const admin = getSupabaseAdmin();
    const { data: existing, error } = await admin.from("exchange_rates")
      .select("rate_date,currency")
      .in("currency", [...ECB_CURRENCIES])
      .order("rate_date", { ascending: false })
      .limit(120);
    if (error) throw new Error(`Could not read saved ECB dates: ${error.message}`);
    const latestByCurrency = new Map<string, string>();
    for (const row of existing ?? []) {
      if (!latestByCurrency.has(row.currency)) latestByCurrency.set(row.currency, row.rate_date);
    }
    // Start from the oldest currency's last saved date. This repairs gaps
    // after a missed cron or partial database write instead of losing them.
    const oldestLatest = ECB_CURRENCIES.every((currency) => latestByCurrency.has(currency))
      ? [...latestByCurrency.values()].sort()[0]
      : EARLIEST_RATE_DATE;
    const startDate = new Date(Math.max(
      Date.parse(`${EARLIEST_RATE_DATE}T00:00:00Z`),
      Date.parse(`${oldestLatest}T00:00:00Z`) - 21 * 86_400_000,
    )).toISOString().slice(0, 10);
    const rows = await fetchEcbRates(startDate);
    const saved = await upsertEcbRates(admin, rows);
    return Response.json({ saved, fromDate: startDate, latestDate: rows.map((row) => row.rate_date).sort().at(-1) });
  } catch (error) {
    console.error("ECB exchange-rate refresh failed", error);
    return Response.json({ error: "ECB exchange-rate refresh failed." }, { status: 502 });
  }
}
