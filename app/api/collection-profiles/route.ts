import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";

type Edition = { id: string; title: string | null; series: string | null; volume_number: string | number | null; language: string | null; isbn_13: string | null; printing_number: number | null; edition_statement: string | null; variant_name: string | null };

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

async function editionForId(id: string) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("manga_editions")
    .select("id,title,series,volume_number,language,isbn_13,printing_number,edition_statement,variant_name")
    .eq("id", id).eq("is_verified", true).maybeSingle();
  if (error) throw new Error("The selected edition could not be checked.");
  return (data as Edition | null) ?? null;
}

export async function GET(request: NextRequest) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  const query = clean(request.nextUrl.searchParams.get("q"));
  const editionId = clean(request.nextUrl.searchParams.get("editionId"));
  const admin = getSupabaseAdmin();
  const [{ data: sources, error: sourceError }, editionResult] = await Promise.all([
    admin.from("sources").select("id,name").eq("is_active", true).order("name"),
    editionId ? editionForId(editionId) : query.length >= 2
      ? admin.from("manga_editions").select("id,title,series,volume_number,language,isbn_13,printing_number,edition_statement,variant_name")
        .ilike("title", `%${query.replace(/[\\%_]/g, "\\$&")}%`).eq("is_verified", true).order("title").limit(8)
      : Promise.resolve([]),
  ]);
  if (sourceError) return Response.json({ error: "RAR marketplace sources could not be loaded." }, { status: 500 });
  if (editionId) {
    if (!editionResult) return Response.json({ error: "Choose a verified RAR edition before creating a profile." }, { status: 404 });
    return Response.json({ edition: editionResult, sources: sources ?? [] });
  }
  return Response.json({ editions: editionResult ?? [], sources: sources ?? [] });
}

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "Send a valid search profile." }, { status: 400 }); }
  const editionId = clean(payload.editionId); const sourceId = clean(payload.sourceId); const searchQuery = clean(payload.searchQuery); const scopeNotes = clean(payload.scopeNotes);
  const interval = Number(payload.collectionIntervalDays);
  if (!editionId || !sourceId || !searchQuery || scopeNotes.length < 20 || !Number.isInteger(interval) || interval < 1 || interval > 365) {
    return Response.json({ error: "Choose an edition and source, add the exact search query, a clear boundary note, and a collection interval from 1–365 days." }, { status: 400 });
  }
  try {
    const edition = await editionForId(editionId);
    if (!edition) return Response.json({ error: "Choose a verified RAR edition before creating a profile." }, { status: 400 });
    const admin = getSupabaseAdmin();
    const { data: source, error: sourceError } = await admin.from("sources").select("id").eq("id", sourceId).eq("is_active", true).maybeSingle();
    if (sourceError || !source) return Response.json({ error: "Choose an active RAR marketplace source." }, { status: 400 });
    const { data: profile, error } = await admin.from("marketplace_search_profiles")
      .insert({ edition_id: edition.id, source_id: source.id, search_query: searchQuery, scope_notes: scopeNotes, collection_interval_days: interval, is_active: true })
      .select("id").single();
    if (error?.code === "23505") return Response.json({ error: "That exact marketplace profile already exists. It was not duplicated." }, { status: 409 });
    if (error || !profile) return Response.json({ error: "The marketplace profile could not be created." }, { status: 500 });
    return Response.json({ profileId: profile.id });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The marketplace profile could not be created." }, { status: 400 }); }
}
