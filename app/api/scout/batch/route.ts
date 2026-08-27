import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import { runScoutBatch } from "@/lib/scoutBatch";

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });

  let payload: { limit?: unknown } = {};
  try {
    payload = await request.json();
  } catch {
    // The safe default batch size applies when no body was sent.
  }

  try {
    return Response.json(await runScoutBatch(getSupabaseAdmin(), { limit: payload.limit }));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Scout could not complete this batch.";
    return Response.json({ error: message }, { status: message.includes("token") ? 503 : 500 });
  }
}
