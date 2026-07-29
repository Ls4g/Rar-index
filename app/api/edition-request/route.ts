import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const collectibleTypes = ["tankobon", "zasshi", "convention_exclusive", "promo_variant", "graded"] as const;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validHttpUrl(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function anonymousFingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Send a valid edition request." }, { status: 400 });
  }

  const requestedTitle = clean(payload.requestedTitle);
  const series = clean(payload.series);
  const volumeNumber = clean(payload.volumeNumber);
  const language = clean(payload.language);
  const publisher = clean(payload.publisher);
  const isbn13 = clean(payload.isbn13);
  const collectibleType = clean(payload.collectibleType);
  const sourceUrl = clean(payload.sourceUrl);
  const copyrightEvidenceUrl = clean(payload.copyrightEvidenceUrl);
  const notes = clean(payload.notes);
  const website = clean(payload.website);

  if (website) return Response.json({ ok: true });
  if (requestedTitle.length < 2 || requestedTitle.length > 300) return Response.json({ error: "Use an item name between 2 and 300 characters." }, { status: 400 });
  if (!collectibleTypes.includes(collectibleType as typeof collectibleTypes[number])) return Response.json({ error: "Choose a valid collectible type." }, { status: 400 });
  if (notes.length < 20 || notes.length > 3000) return Response.json({ error: "Explain the request in 20 to 3,000 characters." }, { status: 400 });
  if (!validHttpUrl(sourceUrl) || !validHttpUrl(copyrightEvidenceUrl)) return Response.json({ error: "Use a valid http or https source URL." }, { status: 400 });
  if (isbn13 && !/^[0-9Xx -]{10,20}$/.test(isbn13)) return Response.json({ error: "ISBN must contain 10 to 20 ISBN characters." }, { status: 400 });

  try {
    const admin = getSupabaseAdmin();
    const { data: accepted, error: limitError } = await admin.rpc("register_catalogue_request_submission", {
      p_fingerprint: await anonymousFingerprint(request),
    });
    if (limitError) return Response.json({ error: "RAR request protection is temporarily unavailable." }, { status: 503 });
    if (!accepted) return Response.json({ error: "Too many requests from this connection. Please try again in an hour." }, { status: 429 });

    const { error } = await admin.from("catalogue_requests").insert({
      requested_title: requestedTitle,
      series: series || null,
      volume_number: volumeNumber || null,
      language: language || null,
      publisher: publisher || null,
      isbn_13: isbn13 || null,
      collectible_type: collectibleType,
      original_source_url: sourceUrl || null,
      copyright_evidence_url: copyrightEvidenceUrl || null,
      requester_notes: notes,
    });
    if (error) return Response.json({ error: "RAR could not save this request right now." }, { status: 500 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "RAR requests are temporarily unavailable." }, { status: 503 });
  }
}
