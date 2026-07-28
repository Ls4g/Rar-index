import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";

type ProfileRecord = { id: string; edition_id: string; is_active: boolean };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: NextRequest) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });

  const editionId = (request.nextUrl.searchParams.get("editionId") ?? "").trim();
  if (!editionId) return Response.json({ runs: [] });

  const admin = getSupabaseAdmin();
  const { data: profiles, error: profileError } = await admin
    .from("marketplace_search_profiles")
    .select("id")
    .eq("edition_id", editionId)
    .eq("is_active", true);
  if (profileError) return Response.json({ error: "Collection profiles could not be loaded." }, { status: 500 });

  const profileIds = (profiles ?? []).map((profile) => profile.id);
  if (!profileIds.length) return Response.json({ runs: [] });

  const { data, error } = await admin
    .from("marketplace_collection_runs")
    .select("id, profile_id, checked_at, checked_by, candidate_count, notes")
    .in("profile_id", profileIds)
    .order("checked_at", { ascending: false })
    .limit(30);
  if (error) return Response.json({ error: "Collection runs could not be loaded." }, { status: 500 });
  return Response.json({ runs: data ?? [] });
}

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });

  let payload: { profileId?: unknown; checkedBy?: unknown; candidateCount?: unknown; notes?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a valid collection-run record." }, { status: 400 });
  }

  const profileId = clean(payload.profileId);
  const checkedBy = clean(payload.checkedBy);
  const notes = clean(payload.notes);
  const candidateCount = typeof payload.candidateCount === "number" ? payload.candidateCount : Number.NaN;
  if (!profileId || !checkedBy || notes.length < 3 || !Number.isInteger(candidateCount) || candidateCount < 0) {
    return Response.json({ error: "Add a reviewer, a whole-number candidate count, and a short factual note." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: profile, error: profileError } = await admin
    .from("marketplace_search_profiles")
    .select("id, edition_id, is_active")
    .eq("id", profileId)
    .maybeSingle();
  const typedProfile = profile as ProfileRecord | null;
  if (profileError || !typedProfile?.is_active) return Response.json({ error: "Choose an active marketplace search profile." }, { status: 400 });

  const checkedAt = new Date().toISOString();
  const { data: run, error: runError } = await admin
    .from("marketplace_collection_runs")
    .insert({ profile_id: typedProfile.id, checked_at: checkedAt, checked_by: checkedBy, candidate_count: candidateCount, notes })
    .select("id, profile_id, checked_at, checked_by, candidate_count, notes")
    .single();
  if (runError || !run) return Response.json({ error: "The collection run could not be recorded." }, { status: 500 });

  const { error: profileUpdateError } = await admin
    .from("marketplace_search_profiles")
    .update({ last_checked_at: checkedAt, last_checked_result_count: candidateCount, updated_at: checkedAt })
    .eq("id", typedProfile.id);
  if (profileUpdateError) return Response.json({ error: "The run was saved, but the profile summary could not be updated." }, { status: 500 });

  return Response.json({ run });
}
