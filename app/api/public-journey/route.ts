import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isPublicJourneyEvent, sameOriginEvent } from "@/lib/publicJourney";

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    return new Response(null, { status: 204 });
  }
  if (!sameOriginEvent(request) || request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return new Response(null, { status: 403 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 128) return new Response(null, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return new Response(null, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || !isPublicJourneyEvent((body as Record<string, unknown>).event)) return new Response(null, { status: 400 });
  const { error } = await getSupabaseAdmin().from("public_journey_events")
    .insert({ event_type: (body as { event: string }).event });
  if (error) return new Response(null, { status: 503 });
  return new Response(null, { status: 204 });
}
