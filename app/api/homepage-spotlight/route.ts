import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });

  let payload: { editionId?: unknown; accentColor?: unknown; reviewer?: unknown; note?: unknown };
  try {
    payload = await request.json() as typeof payload;
  } catch {
    return Response.json({ error: "Send a valid spotlight selection." }, { status: 400 });
  }

  const editionId = typeof payload.editionId === "string" ? payload.editionId : "";
  const accentColor = typeof payload.accentColor === "string" ? payload.accentColor : "";
  const reviewer = typeof payload.reviewer === "string" ? payload.reviewer.trim() : "";
  const note = typeof payload.note === "string" ? payload.note.trim() : "";
  if (!editionId || !reviewer || !/^#[0-9a-f]{6}$/i.test(accentColor)) {
    return Response.json({ error: "Choose an edition, accent colour, and reviewer." }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const { data: edition, error: editionError } = await admin
      .from("manga_editions")
      .select("id")
      .eq("id", editionId)
      .eq("record_kind", "publication")
      .eq("is_verified", true)
      .eq("cover_verification_status", "verified")
      .not("cover_image_url", "is", null)
      .maybeSingle();
    if (editionError || !edition) return Response.json({ error: "The spotlight must be a verified publication with a confirmed cover." }, { status: 400 });

    const { error } = await admin.from("homepage_feature_selections").insert({
      slot: "edition_of_week",
      edition_id: editionId,
      selection_method: "manual",
      accent_color: accentColor,
      selection_note: note || null,
      selected_by: reviewer,
    });
    if (error) return Response.json({ error: "RAR could not save this selection." }, { status: 500 });
    revalidatePath("/");
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "RAR spotlight management is temporarily unavailable." }, { status: 503 });
  }
}
