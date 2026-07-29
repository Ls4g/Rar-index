import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type Decision = "reviewed" | "rejected" | "converted";

type CommunityReport = {
  id: string;
  report_type: string;
  source_listing_url: string;
  listing_title: string | null;
  reported_price: number | null;
  currency: string | null;
  sold_date: string | null;
  reporter_notes: string;
  status: string;
  manga_editions: {
    id: string;
    title: string | null;
    series: string | null;
    volume_number: string | number | null;
    language: string | null;
    isbn_13: string | null;
    publisher: string | null;
    format: string | null;
    printing_number: number | null;
    edition_statement: string | null;
    variant_name: string | null;
  } | null;
};

function isStaffRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  const username = process.env.RAR_REVIEW_USERNAME;
  const password = process.env.RAR_REVIEW_PASSWORD;
  if (!username || !password || !authorization?.startsWith("Basic ")) return false;
  try {
    const [providedUsername, providedPassword] = atob(authorization.slice(6)).split(":");
    return providedUsername === username && providedPassword === password;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isStaffRequest(request)) return Response.json({ error: "Staff credentials are required." }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return Response.json({ error: "Community report review is not configured yet." }, { status: 503 });

  let payload: { reportId?: unknown; decision?: unknown; notes?: unknown; reviewer?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a valid report decision." }, { status: 400 });
  }

  const reportId = typeof payload.reportId === "string" ? payload.reportId : "";
  const decision = typeof payload.decision === "string" ? payload.decision : "";
  const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
  const reviewer = typeof payload.reviewer === "string" ? payload.reviewer.trim() : "";
  const decisions: Decision[] = ["reviewed", "rejected", "converted"];
  if (!reportId || !decisions.includes(decision as Decision) || notes.length < 12 || !reviewer) {
    return Response.json({ error: "Choose a decision, add at least 12 characters of evidence, and identify the reviewer." }, { status: 400 });
  }

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.rpc("apply_community_report_decision", {
    p_report_id: reportId,
    p_decision: decision,
    p_decision_notes: notes,
    p_reviewed_by: reviewer,
  });
  if (error) return Response.json({ error: "The community report decision could not be saved." }, { status: 500 });
  return Response.json({ ok: true });
}

export async function GET(request: Request) {
  if (!isStaffRequest(request)) return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  const reportId = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!reportId) return Response.json({ error: "Choose a community report." }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("community_sale_reports")
    .select("id,report_type,source_listing_url,listing_title,reported_price,currency,sold_date,reporter_notes,status,manga_editions(id,title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name)")
    .eq("id", reportId)
    .maybeSingle();
  const report = data as unknown as CommunityReport | null;
  if (error || !report) return Response.json({ error: "This community report could not be loaded." }, { status: 404 });
  if (report.status !== "converted" || report.report_type !== "sale" || !report.manga_editions) {
    return Response.json({ error: "Only a sale report marked for import can open the handoff workspace." }, { status: 400 });
  }

  const { data: sources, error: sourceError } = await admin
    .from("sources")
    .select("id,name,base_url")
    .eq("is_active", true)
    .order("name");
  if (sourceError) return Response.json({ error: "RAR marketplace sources could not be loaded." }, { status: 500 });

  let suggestedSourceId: string | null = null;
  try {
    const reportHost = new URL(report.source_listing_url).hostname.replace(/^www\./, "");
    suggestedSourceId = (sources ?? []).find((source) => {
      try {
        return new URL(source.base_url).hostname.replace(/^www\./, "") === reportHost;
      } catch {
        return false;
      }
    })?.id ?? null;
  } catch {}

  const ebayId = /\/itm\/(\d{8,20})/i.exec(report.source_listing_url)?.[1] ?? null;
  return Response.json({
    report: {
      id: report.id,
      sourceListingUrl: report.source_listing_url,
      listingTitle: report.listing_title,
      reportedPrice: report.reported_price,
      currency: report.currency,
      soldDate: report.sold_date,
      reporterNotes: report.reporter_notes,
      externalId: ebayId,
      edition: report.manga_editions,
    },
    sources: sources ?? [],
    suggestedSourceId,
  });
}
