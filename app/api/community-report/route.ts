import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const reportTypes = ["sale", "pricing_issue", "edition_issue"] as const;
type ReportType = typeof reportTypes[number];

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Send a valid report." }, { status: 400 });
  }

  const editionId = clean(payload.editionId);
  const reportType = clean(payload.reportType) as ReportType;
  const sourceUrl = clean(payload.sourceUrl);
  const listingTitle = clean(payload.listingTitle);
  const priceText = clean(payload.reportedPrice);
  const currency = clean(payload.currency).toUpperCase();
  const soldDate = clean(payload.soldDate);
  const notes = clean(payload.notes);
  const website = clean(payload.website);

  // Quietly accept obvious bot submissions without storing them.
  if (website) return Response.json({ ok: true });
  if (!editionId || !reportTypes.includes(reportType)) return Response.json({ error: "Choose the edition and report type." }, { status: 400 });
  if (!validHttpUrl(sourceUrl)) return Response.json({ error: "Add a valid original source URL." }, { status: 400 });
  if (listingTitle.length > 400) return Response.json({ error: "Keep the source title under 400 characters." }, { status: 400 });
  if (notes.length < 20 || notes.length > 3_000) return Response.json({ error: "Explain the report in 20 to 3,000 characters." }, { status: 400 });

  const price = priceText ? Number(priceText) : undefined;
  if (price !== undefined && (!Number.isFinite(price) || price <= 0)) return Response.json({ error: "Reported price must be a positive number." }, { status: 400 });
  if (currency && !/^[A-Z]{3}$/.test(currency)) return Response.json({ error: "Currency must use a three-letter code, such as USD or GBP." }, { status: 400 });
  if (soldDate && !validDate(soldDate)) return Response.json({ error: "Sale date must be a real YYYY-MM-DD date." }, { status: 400 });

  try {
    const admin = getSupabaseAdmin();
    const { data: edition, error: editionError } = await admin
      .from("manga_editions")
      .select("id")
      .eq("id", editionId)
      .eq("is_verified", true)
      .maybeSingle();
    if (editionError || !edition) return Response.json({ error: "This edition is no longer available for reports." }, { status: 404 });

    const { error } = await admin.from("community_sale_reports").insert({
      edition_id: editionId,
      report_type: reportType,
      source_listing_url: sourceUrl,
      listing_title: listingTitle || null,
      reported_price: price ?? null,
      currency: currency || null,
      sold_date: soldDate || null,
      reporter_notes: notes,
    });
    if (error) return Response.json({ error: "RAR could not save this report right now." }, { status: 500 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "RAR reports are temporarily unavailable." }, { status: 503 });
  }
}
