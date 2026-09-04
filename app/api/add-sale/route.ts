import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import { ebayMarketplaceFromUrl, extractEbayLegacyItemId } from "@/lib/ebayEvidence";
import { getSubmittedEbaySaleEvidence } from "@/lib/listingOutcomeProviders";
import { detectGrading, detectsBestOffer } from "@/lib/submittedSale";
import { snapshotHoldersOfEdition } from "@/lib/portfolioSnapshot";

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
function positiveNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(text(value));
  return Number.isFinite(number) && number > 0 ? number : null;
}
function nonNegativeNumber(value: unknown) {
  if (value === null || value === undefined || text(value) === "") return null;
  const number = typeof value === "number" ? value : Number(text(value));
  return Number.isFinite(number) && number >= 0 ? number : null;
}
function positiveInteger(value: unknown) {
  const number = typeof value === "number" ? value : Number(text(value));
  return Number.isInteger(number) && number > 0 ? number : null;
}
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date <= new Date();
}
function validUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; }
}

async function exactEdition(id: string) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("manga_editions")
    .select("id,title,series,volume_number,language,isbn_13,publisher,printing_number,edition_statement,variant_name")
    .eq("id", id).eq("is_verified", true).maybeSingle();
  if (error) throw new Error("The selected RAR edition could not be checked.");
  return (data as Edition | null) ?? null;
}

export async function GET(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  const url = new URL(request.url);
  const query = text(url.searchParams.get("q"));
  const editionId = text(url.searchParams.get("editionId"));
  const listingUrl = text(url.searchParams.get("listingUrl"));
  const admin = getSupabaseAdmin();

  if (listingUrl) {
    if (!validUrl(listingUrl)) return Response.json({ error: "Paste a valid eBay item link." }, { status: 400 });
    const itemId = extractEbayLegacyItemId(listingUrl);
    if (!itemId) return Response.json({ error: "RAR could not read an eBay item ID from that link." }, { status: 400 });
    try {
      const evidence = await getSubmittedEbaySaleEvidence(itemId, ebayMarketplaceFromUrl(listingUrl));
      if (evidence.state === "active") {
        return Response.json({ error: "eBay says this listing is still active, so it cannot be added as a completed sale.", evidence }, { status: 409 });
      }
      if (evidence.state === "completed_unsold") {
        return Response.json({ error: "eBay says this listing ended without a sale.", evidence }, { status: 422 });
      }
      if (evidence.state !== "completed_sold") {
        return Response.json({ error: evidence.detail || "eBay could not confirm this as a completed sale. Use manual entry only if you can see the evidence yourself.", evidence }, { status: 422 });
      }
      return Response.json({ evidence });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "eBay could not load this listing." }, { status: 502 });
    }
  }

  if (editionId) {
    const [edition, sourceResult] = await Promise.all([
      exactEdition(editionId),
      admin.from("sources").select("id,name").eq("is_active", true).order("name"),
    ]);
    if (!edition) return Response.json({ error: "Choose a verified RAR edition before approving a sale." }, { status: 404 });
    if (sourceResult.error) return Response.json({ error: "Sale sources could not be loaded." }, { status: 500 });
    return Response.json({ edition, sources: sourceResult.data ?? [] });
  }

  const [{ data: sources, error: sourceError }, editionResult] = await Promise.all([
    admin.from("sources").select("id,name").eq("is_active", true).order("name"),
    query.length >= 2 ? admin.from("manga_editions").select("id,title,series,volume_number,language,isbn_13,publisher,printing_number,edition_statement,variant_name")
      .ilike("title", `%${query.replace(/[\\%_]/g, "\\$&")}%`)
      .eq("is_verified", true).order("title").limit(10)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (sourceError || editionResult.error) return Response.json({ error: "Approved-listing details could not be loaded." }, { status: 500 });
  return Response.json({ editions: editionResult.data ?? [], sources: sources ?? [] });
}

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "Send valid submitted sale evidence." }, { status: 400 }); }

  const action = text(payload.action) || "approve";
  const editionId = text(payload.editionId);
  const sourceId = text(payload.sourceId);
  const sourceListingUrl = text(payload.sourceListingUrl);
  const listingTitle = text(payload.listingTitle);
  const submittedText = text(payload.submittedText).slice(0, 20_000);
  const suppliedExternalId = text(payload.externalId);
  const reviewer = text(payload.reviewer);
  const intakeNotes = text(payload.intakeNotes).slice(0, 2_000);

  if (!editionId || !sourceId || !sourceListingUrl || !listingTitle || !reviewer) {
    return Response.json({ error: "Choose the exact edition and source, then provide the listing link, title, and reviewer." }, { status: 400 });
  }
  if (!validUrl(sourceListingUrl)) return Response.json({ error: "The original completed-listing link must be a valid URL." }, { status: 400 });

  try {
    const admin = getSupabaseAdmin();
    const [edition, sourceResult] = await Promise.all([
      exactEdition(editionId),
      admin.from("sources").select("id,name").eq("id", sourceId).eq("is_active", true).maybeSingle(),
    ]);
    if (!edition) return Response.json({ error: "Choose a verified RAR edition." }, { status: 400 });
    if (sourceResult.error || !sourceResult.data) return Response.json({ error: "Choose an active marketplace source." }, { status: 400 });

    const sourceName = text(sourceResult.data.name);
    const externalId = suppliedExternalId || (sourceName === "eBay Sold" ? extractEbayLegacyItemId(sourceListingUrl) : "");
    if (!externalId) return Response.json({ error: "Add the marketplace listing ID. For eBay, RAR reads it from the item link." }, { status: 400 });

    const detectionText = `${listingTitle}\n${submittedText}`;
    const gradingDetection = detectGrading(detectionText);
    const bestOfferDetected = detectsBestOffer(detectionText);
    const detectorOutput = { grading: gradingDetection, bestOfferDetected };
    const submittedPayload = {
      raw_submitted_text: submittedText || null,
      supplied_fields: {
        source_listing_url: sourceListingUrl,
        external_id: externalId,
        listing_title: listingTitle,
      },
    };

    if (action === "reject") {
      const rejectionReason = text(payload.rejectionReason);
      const { data, error } = await admin.rpc("reject_submitted_sale", {
        p_edition_id: edition.id,
        p_source_id: sourceId,
        p_source_listing_url: sourceListingUrl,
        p_external_id: externalId,
        p_listing_title: listingTitle,
        p_reason_label: rejectionReason,
        p_submitted_payload: submittedPayload,
        p_detector_output: detectorOutput,
        p_decision_notes: intakeNotes,
        p_reviewed_by: reviewer,
      });
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ rejected: true, intakeDecisionId: data });
    }

    if (action !== "approve" || payload.humanConfirmed !== true) {
      return Response.json({ error: "Confirm that you personally inspected this completed sale and exact edition." }, { status: 400 });
    }

    const soldDate = text(payload.soldDate);
    const salePrice = positiveNumber(payload.salePrice);
    const shippingPrice = nonNegativeNumber(payload.shippingPrice);
    const quantity = positiveInteger(payload.quantity);
    const currency = text(payload.currency).toUpperCase();
    const saleType = text(payload.saleType) || "unknown";
    const printClassification = text(payload.printClassification) || "printing_not_identified";
    const printingProofUrl = text(payload.printingProofUrl);
    const priceCorroborationUrl = text(payload.priceCorroborationUrl);
    const knownPrintingNumberText = text(payload.knownPrintingNumber);
    const knownPrintingNumber = knownPrintingNumberText ? positiveInteger(knownPrintingNumberText) : null;
    const isGraded = payload.isGraded === true;
    const gradingCompany = isGraded ? text(payload.gradingCompany).toUpperCase() : "";
    const gradeLabel = isGraded ? text(payload.gradeLabel) : "";

    if (!validDate(soldDate)) return Response.json({ error: "Enter the completed sale date." }, { status: 400 });
    if (salePrice === null) return Response.json({ error: "Enter the item price that was actually paid, excluding delivery." }, { status: 400 });
    if (shippingPrice === null && text(payload.shippingPrice)) return Response.json({ error: "Delivery must be zero or a positive amount." }, { status: 400 });
    if (quantity === null) return Response.json({ error: "Quantity must be at least one." }, { status: 400 });
    if (!/^[A-Z]{3}$/.test(currency)) return Response.json({ error: "Use a three-letter currency such as GBP, USD, or JPY." }, { status: 400 });
    if (!(["auction", "best_offer", "fixed_price", "unknown"] as string[]).includes(saleType)) return Response.json({ error: "Choose a recognised sale type." }, { status: 400 });
    if (!(["printing_not_identified", "known_later_print", "first_print_proven"] as string[]).includes(printClassification)) return Response.json({ error: "Choose a recognised print classification." }, { status: 400 });
    if (isGraded && (!gradingCompany || !gradeLabel)) return Response.json({ error: "Confirm both the grading company and exact grade." }, { status: 400 });
    if (printClassification === "first_print_proven" && (!printingProofUrl || !validUrl(printingProofUrl))) return Response.json({ error: "A proven first print requires a direct copyright-page proof URL." }, { status: 400 });
    if (printingProofUrl && !validUrl(printingProofUrl)) return Response.json({ error: "Printing proof must be a valid URL." }, { status: 400 });
    if (saleType === "best_offer" && (!priceCorroborationUrl || !validUrl(priceCorroborationUrl))) return Response.json({ error: "Best Offer sales require a link confirming the actual accepted price." }, { status: 400 });
    if (priceCorroborationUrl && !validUrl(priceCorroborationUrl)) return Response.json({ error: "Price corroboration must be a valid URL." }, { status: 400 });
    if (knownPrintingNumberText && knownPrintingNumber === null) return Response.json({ error: "Known printing number must be a positive whole number." }, { status: 400 });

    const confirmedOutput = {
      sold_date: soldDate,
      sale_price: salePrice,
      currency,
      shipping_price: shippingPrice,
      quantity,
      sale_type: saleType,
      grading_company: gradingCompany || null,
      grade_label: gradeLabel || null,
      print_classification: printClassification,
      printing_proof_url: printingProofUrl || null,
      price_corroboration_url: priceCorroborationUrl || null,
    };
    const enrichedPayload = {
      ...submittedPayload,
      selected_edition: edition,
      confirmed_fields: confirmedOutput,
      human_corrections: {
        grading: gradingDetection.isGraded !== isGraded || gradingDetection.company !== gradingCompany || gradingDetection.grade !== gradeLabel,
        best_offer: bestOfferDetected !== (saleType === "best_offer"),
      },
    };

    const { data: observationId, error } = await admin.rpc("approve_submitted_sale", {
      p_edition_id: edition.id,
      p_source_id: sourceId,
      p_source_listing_url: sourceListingUrl,
      p_external_id: externalId,
      p_listing_title: listingTitle,
      p_sold_date: soldDate,
      p_sale_price: salePrice,
      p_currency: currency,
      p_shipping_price: shippingPrice,
      p_quantity: quantity,
      p_sale_type: saleType,
      p_grading_company: gradingCompany || null,
      p_grade_label: gradeLabel || null,
      p_print_classification: printClassification,
      p_printing_proof_url: printingProofUrl || null,
      p_known_printing_number: knownPrintingNumber,
      p_price_corroboration_url: priceCorroborationUrl || null,
      p_submitted_payload: enrichedPayload,
      p_detector_output: detectorOutput,
      p_decision_notes: intakeNotes,
      p_reviewed_by: reviewer,
    });
    if (error) {
      const status = error.message.includes("already exists") ? 409 : 400;
      return Response.json({ error: error.message }, { status });
    }

    try { await snapshotHoldersOfEdition(admin, edition.id); } catch { /* The evidence transaction already succeeded. */ }
    return Response.json({ observationId, verified: true, classified: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The approved listing could not be saved." }, { status: 400 });
  }
}
