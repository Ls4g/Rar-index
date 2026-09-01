// How often a publication actually changes hands.
//
// A median price says nothing about whether a copy comes up weekly or once a
// decade, and that gap is exactly where a collector gets a false sense of a
// number. Two sales are not a rate, and neither is a fortnight of activity,
// so both cases return null rather than a figure RAR cannot stand behind.
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30.44;
const MIN_SALES = 3;
const MIN_SPAN_DAYS = 21;

export type SaleFrequency = {
  perMonth: number;
  label: string;
  spanDays: number;
};

export function describeSaleFrequency(soldDates: Array<string | null | undefined>): SaleFrequency | null {
  const times = soldDates
    .flatMap((value) => {
      if (!value) return [];
      const time = new Date(`${value}T00:00:00`).getTime();
      return Number.isFinite(time) ? [time] : [];
    })
    .sort((a, b) => a - b);

  if (times.length < MIN_SALES) return null;

  const spanDays = (times[times.length - 1] - times[0]) / MS_PER_DAY;
  if (spanDays < MIN_SPAN_DAYS) return null;

  // Intervals between sales, not sales themselves: three sales across two
  // months is two intervals, so roughly one a month rather than 1.5.
  const perMonth = (times.length - 1) / (spanDays / DAYS_PER_MONTH);

  return { perMonth, spanDays, label: frequencyLabel(perMonth) };
}

function frequencyLabel(perMonth: number) {
  if (perMonth >= 6) return "several a week";
  if (perMonth >= 3) return "roughly one a week";
  if (perMonth >= 1.5) return `roughly ${Math.round(perMonth)} a month`;
  if (perMonth >= 0.75) return "roughly one a month";

  const monthsPerSale = 1 / perMonth;
  if (monthsPerSale <= 11) {
    const months = Math.max(1, Math.round(monthsPerSale));
    return months === 1 ? "roughly one every month" : `roughly one every ${months} months`;
  }

  const yearsPerSale = monthsPerSale / 12;
  if (yearsPerSale < 1.5) return "roughly one a year";
  return `roughly one every ${Math.round(yearsPerSale)} years`;
}
