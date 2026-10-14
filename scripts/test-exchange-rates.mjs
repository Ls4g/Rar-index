import assert from "node:assert/strict";
import { parseEcbRatesCsv } from "../lib/ecbExchangeRates.ts";
import { convertSale } from "../lib/fx.ts";

const csv = [
  "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,TITLE,TITLE_COMPL",
  'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-09,1.12,"Dollar, US","US dollar/Euro"',
  'EXR.D.GBP.EUR.SP00.A,D,GBP,EUR,SP00,A,2026-10-09,0.84,"Pound, sterling","Pound/Euro"',
  'EXR.D.CAD.EUR.SP00.A,D,CAD,EUR,SP00,A,2026-10-09,1.60,"Dollar, Canadian","CAD/Euro"',
].join("\n");

const rows = parseEcbRatesCsv(csv, "2026-10-14T00:00:00Z");
assert.equal(rows.length, 3);
assert.equal(rows.find((row) => row.currency === "GBP")?.rate_per_eur, 0.84);
assert.equal(rows.find((row) => row.currency === "CAD")?.source_series, "EXR.D.CAD.EUR.SP00.A");
assert.throws(() => parseEcbRatesCsv(csv.replace("1.60", "not-a-rate")), /required currencies/);
assert.throws(() => parseEcbRatesCsv("<html>error</html>"), /unexpected CSV/);

const usdSale = { sold_date: "2026-10-11", sale_price: 100, currency: "USD", grading_company: null, grade_label: null };
assert.ok(Math.abs((convertSale(usdSale, "GBP", rows)?.converted_price ?? 0) - 75) < 0.00001);
assert.equal(convertSale(usdSale, "USD", [])?.converted_price, 100, "original currency needs no ECB rate");
assert.equal(convertSale({ ...usdSale, sold_date: "2026-10-25" }, "GBP", rows), null, "a stale rate must not price a recent sale");
assert.equal(convertSale({ ...usdSale, sold_date: "2026-10-25" }, "USD", rows)?.converted_price, 100);

console.log("ECB parsing and chart conversion tests passed.");
