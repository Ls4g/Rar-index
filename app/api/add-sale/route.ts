import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";

type Edition = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | number | null;
  language: string | null;
  isbn_13: string | null;
  publisher: string | null;
  printing_number: number | null;
  edition_statement: string | null;
  variant_name: string | null;
};

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; }
}
function extractEbayId(url: string) { return url.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/i)?.[1] ?? ""; }

async function exactEdition(id: string) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("manga_editions")
    .select("id,title,series,volume_number,language,isbn_13,publisher,printing_number,edition_statement,variant_name")
    .eq("id", id).eq("is_verified", true).maybeSingle();
  if (error) throw new Error("The selected RAR edition could not be checked.");
  return (data as Edition | null) ?? null;
}

export async function GET(request: NextRequest) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  const query = text(request.nextUrl.searchParams.get("q"));
  const editionId = text(request.nextUrl.searchParams.get("editionId"));
  const admin = getSupabaseAdmin();

  if (editionId) {
    const [edition, sourceResult] = await Promise.all([
      exactEdition(editionId),
      admin.from("sources").select("id,name").eq("is_active", true).order("name"),
    ]);
    if (!edition) return Response.json({ error: "Choose a verified RAR edition before adding a sale." }, { status: 404 });
    if (sourceResult.error) return Response.json({ error: "Sale sources could not be loaded." }, { status: 500 });
    return Response.json({ edition, sources: sourceResult.data ?? [] });
  }

  const [{ data: sources, error: sourceError }, editionResult] = await Promise.all([
    admin.from("sources").select("id,name").eq("is_active", true).order("name"),
    query.length >= 2 ? admin.from("manga_editions").select("id,title,series,volume_number,language,isbn_13,printing_number,edition_statement,variant_name")
      .ilike("title", `%${query.replace(/[\\%_]/g, "\\$&")}%`).eq("is_verified", true).order("title").limit(8)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (sourceError || editionResult.error) return Response.json({ error: "Quick sale details could not be loaded." }, { status: 500 });
  return Response.json({ editions: editionResult.data ?? [], sources: sources ?? [] });
}

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "Send a valid completed-sale record." }, { status: 400 }); }

  const editionId = text(payload.editionId); const sourceId = text(payload.sourceId);
  const sourceListingUrl = text(payload.sourceListingUrl); const listingTitle = text(payload.listingTitle); const soldDate = text(payload.soldDate);
  const currency = text(payload.currency).toUpperCase(); const saleType = text(payload.saleType) || "unknown";
  const evidenceImageUrl = text(payload.evidenceImageUrl); const intakeNotes = text(payload.intakeNotes); const suppliedExternalId = text(payload.externalId);
  const salePrice = typeof payload.salePrice === "number" ? payload.salePrice : Number(text(payload.salePrice));
  if (!editionId || !sourceId || !sourceListingUrl || !listingTitle || !soldDate || !currency) return Response.json({ error: "Select the exact edition, then add the original completed-sale link, source, title, date, price, and currency." }, { status: 400 });
  if (!validUrl(sourceListingUrl)) return Response.json({ error: "The original listing link must be a valid http or https URL." }, { status: 400 });
  if (evidenceImageUrl && !validUrl(evidenceImageUrl)) return Response.json({ error: "The optional proof image link must be a valid http or https URL." }, { status: 400 });
  if (!validDate(soldDate)) return Response.json({ error: "Use a real sale date in YYYY-MM-DD format." }, { status: 400 });
  if (!Number.isFinite(salePrice) || salePrice <= 0) return Response.json({ error: "Sale price must be greater than zero." }, { status: 400 });
  if (!/^[A-Z]{3}$/.test(currency)) return Response.json({ error: "Currency must use a three-letter code such as GBP, USD, or JPY." }, { status: 400 });
  if (!(["auction", "best_offer", "fixed_price", "unknown"] as string[]).includes(saleType)) return Response.json({ error: "Choose a recognised sale type." }, { status: 400 });

  try {
    const edition = await exactEdition(editionId);
    if (!edition) return Response.json({ error: "Choose a verified RAR edition before adding a sale." }, { status: 400 });
    const admin = getSupabaseAdmin();
    const { data: source, error: sourceError } = await admin.from("sources").select("id,name").eq("id", sourceId).eq("is_active", true).maybeSingle();
    if (sourceError || !source) return Response.json({ error: "Choose an active RAR marketplace source." }, { status: 400 });
    const externalId = suppliedExternalId || (source.name === "eBay Sold" ? extractEbayId(sourceListingUrl) : "");
    if (!externalId) return Response.json({ error: "Add the marketplace listing ID. For eBay, it is normally the number in the item link." }, { status: 400 });
    const { data: duplicate, error: duplicateError } = await admin.from("price_observations").select("id").eq("source_id", source.id).eq("external_id", externalId).maybeSingle();
    if (duplicateError) return Response.json({ error: "RAR could not check for an existing sale." }, { status: 500 });
    if (duplicate) return Response.json({ error: "This marketplace listing already exists in RAR. It was not changed." }, { status: 409 });
    const { data: observation, error: insertError } = await admin.from("price_observations").insert({
      edition_id: edition.id, collection_run_id: null, source_id: source.id, source_listing_url: sourceListingUrl, external_id: externalId,
      listing_title: listingTitle, sold_date: soldDate, sale_price: salePrice, currency, quantity: 1, sale_type: saleType,
      is_verified: false, match_status: "needs_review", sale_status: "confirmed",
      raw_payload: { source: "quick-sale-v1", intake_method: "manual_source_entry", captured_at: new Date().toISOString(), selected_edition: edition, evidence_image_url: evidenceImageUrl || null, intake_notes: intakeNotes || null },
      notes: "Added through Quick sale intake. Awaiting staff review of the original listing and exact-edition evidence.",
    }).select("id").single();
    if (insertError?.code === "23505") return Response.json({ error: "This marketplace listing already exists in RAR. It was not changed." }, { status: 409 });
    if (insertError || !observation) return Response.json({ error: "The sale could not be queued. Nothing was verified automatically." }, { status: 500 });
    return Response.json({ observationId: observation.id });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The sale could not be queued." }, { status: 400 }); }
}
