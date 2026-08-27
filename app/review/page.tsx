import Link from "next/link";
import HumanDecisionInbox from "@/components/HumanDecisionInbox";
import StaffNav from "@/components/StaffNav";
import { isExecutableAgentAction } from "@/lib/agentActionExecution";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const ACTION_DESTINATIONS: Record<string, string> = {
  review_catalogue_queue: "/catalogue-review",
  research_catalogue_requests: "/catalogue-requests",
  source_missing_covers: "/cover-review",
  triage_scout_leads: "/scout",
  scan_stale_profiles: "/collection-profiles",
  tune_low_yield_profiles: "/collection-profiles",
  review_sales_evidence: "/review",
  classify_printing_evidence: "/review",
  review_community_reports: "/community-reports",
  resolve_readiness_bottleneck: "/data-readiness",
  investigate_agent_failures: "/agents#run-log",
  review_scout_feedback_conflicts: "/scout",
  review_scout_feedback_recall: "/scout",
  review_scout_feedback_precision: "/scout",
  shadow_test_first_print_proof_gate: "/agents",
  shadow_test_multi_volume_detection: "/agents",
  shadow_test_edition_conflicts: "/agents",
  review_scout_rule_regression: "/agents",
};

type PriceRow = {
  observation_id: string;
  listing_title: string | null;
  source_listing_url: string | null;
  sold_date: string | null;
  sale_price: number | null;
  currency: string | null;
  match_notes: string | null;
  edition_title: string | null;
  edition_series: string | null;
  edition_volume_number: string | null;
  edition_language: string | null;
};

type PrintRow = {
  observation_id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  listing_title: string | null;
  source_listing_url: string | null;
};

type AgentAction = {
  id: string;
  agent_key: string;
  action_type: string;
  title: string;
  rationale: string;
  confidence: number | null;
  target_id: string | null;
  evidence: Record<string, unknown> | null;
  proposed_payload: Record<string, unknown> | null;
};

type CatalogueRow = {
  id: string;
  candidate_kind: "edition_candidate" | "series_reference";
  candidate_title: string;
  candidate_series: string | null;
  candidate_volume_number: string | null;
  candidate_author: string | null;
  candidate_publisher: string | null;
  candidate_language: string | null;
  candidate_isbn_13: string | null;
  candidate_release_date: string | null;
  source_name: string | null;
  source_record_url: string;
  raw_payload: {
    review_metadata?: {
      collectible_type?: string | null;
      magazine_title_id?: string | null;
      issue_year?: string | null;
      issue_number_label?: string | null;
      cumulative_issue_no?: string | null;
      madb_id?: string | null;
    } | null;
  } | null;
};

function editionLabel(row: { title?: string | null; series?: string | null; volume?: string | null; language?: string | null }) {
  return [row.title || row.series, row.volume ? `Vol. ${row.volume}` : null, row.language].filter(Boolean).join(" · ") || "Edition not labelled";
}

export default async function HumanDecisionsPage() {
  const admin = getSupabaseAdmin();
  const [saleResult, printResult, actionResult, catalogueResult] = await Promise.all([
    admin.from("price_review_queue").select("observation_id,listing_title,source_listing_url,sold_date,sale_price,currency,match_notes,edition_title,edition_series,edition_volume_number,edition_language").eq("match_status", "needs_review").order("queued_at", { ascending: false }).limit(40),
    admin.from("print_classification_queue").select("observation_id,title,series,volume_number,language,listing_title,source_listing_url").limit(40),
    admin.from("agent_actions").select("id,agent_key,action_type,title,rationale,confidence,target_id,evidence,proposed_payload").eq("status", "proposed").order("created_at", { ascending: false }).limit(100),
    admin.from("catalogue_review_queue").select("id,candidate_kind,candidate_title,candidate_series,candidate_volume_number,candidate_author,candidate_publisher,candidate_language,candidate_isbn_13,candidate_release_date,source_name,source_record_url,raw_payload").order("imported_at", { ascending: false }).limit(30),
  ]);

  const errors = [saleResult.error, printResult.error, actionResult.error, catalogueResult.error].filter(Boolean);
  const actions = (actionResult.data ?? []) as AgentAction[];
  const printByObservation = new Map(((printResult.data ?? []) as PrintRow[]).map((row) => [row.observation_id, row]));
  const printActions = actions.filter((action) => action.action_type === "suggest_print_classification" && action.target_id && printByObservation.has(action.target_id));
  const proposals = actions.filter((action) => action.action_type !== "suggest_print_classification");

  const sales = ((saleResult.data ?? []) as PriceRow[])
    .filter((row) => Boolean(row.source_listing_url) && row.sale_price !== null && Boolean(row.currency))
    .map((row) => ({
      observationId: row.observation_id,
      listingTitle: row.listing_title ?? "Untitled completed listing",
      sourceUrl: row.source_listing_url as string,
      soldDate: row.sold_date,
      price: row.sale_price as number,
      currency: row.currency as string,
      editionLabel: editionLabel({ title: row.edition_title, series: row.edition_series, volume: row.edition_volume_number, language: row.edition_language }),
      reason: row.match_notes,
    }));

  const printing = printActions.map((action) => {
    const row = printByObservation.get(action.target_id as string) as PrintRow;
    const payload = action.proposed_payload ?? {};
    const evidence = action.evidence ?? {};
    const classification = payload.classification === "known_later_print" ? "known_later_print" as const : "first_print_proven" as const;
    const proofUrl = typeof payload.proof_url === "string" ? payload.proof_url : typeof evidence.evidence_image_url === "string" ? evidence.evidence_image_url : "";
    return {
      actionId: action.id,
      observationId: row.observation_id,
      listingTitle: row.listing_title ?? "Untitled completed listing",
      sourceUrl: row.source_listing_url ?? "",
      editionLabel: editionLabel({ title: row.title, series: row.series, volume: row.volume_number, language: row.language }),
      classification,
      proofUrl,
      printingNumber: typeof payload.printing_number === "number" ? payload.printing_number : null,
      rationale: action.rationale,
      confidence: action.confidence,
    };
  }).filter((item) => Boolean(item.sourceUrl));

  const catalogue = ((catalogueResult.data ?? []) as CatalogueRow[]).map((row) => ({
    id: row.id,
    title: row.candidate_title,
    series: row.candidate_series,
    volumeNumber: row.candidate_volume_number,
    author: row.candidate_author,
    publisher: row.candidate_publisher,
    language: row.candidate_language,
    isbn13: row.candidate_isbn_13,
    releaseDate: row.candidate_release_date,
    sourceName: row.source_name,
    sourceUrl: row.source_record_url,
    isEditionCandidate: row.candidate_kind === "edition_candidate",
    reviewMetadata: {
      collectibleType: row.raw_payload?.review_metadata?.collectible_type ?? null,
      magazineTitleId: row.raw_payload?.review_metadata?.magazine_title_id ?? null,
      issueYear: row.raw_payload?.review_metadata?.issue_year ?? null,
      issueNumberLabel: row.raw_payload?.review_metadata?.issue_number_label ?? null,
      cumulativeIssueNo: row.raw_payload?.review_metadata?.cumulative_issue_no ?? null,
      madbId: row.raw_payload?.review_metadata?.madb_id ?? null,
    },
  }));

  const agentProposals = proposals.map((action) => ({
    id: action.id,
    agentKey: action.agent_key,
    actionType: action.action_type,
    title: action.title,
    rationale: action.rationale,
    confidence: action.confidence,
    destination: ACTION_DESTINATIONS[action.action_type] ?? null,
    canExecute: isExecutableAgentAction(action.action_type),
  }));

  const actionableCount = sales.length + printing.length + catalogue.length + agentProposals.filter((action) => action.confidence !== null && action.confidence >= 0.9).length;

  return (
    <main className="review-page human-decisions-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/agents">Agent health and settings →</Link>
        <StaffNav current="/review" />
      </header>

      <section className="review-hero human-decisions-hero">
        <div><p className="eyebrow">Human input only</p><h1>Decisions</h1><p>The agents prepare the work. Check the evidence, answer yes or no, and move on.</p></div>
        <div className="queue-total"><strong>{actionableCount}</strong><span>decisions needing you</span></div>
      </section>

      {errors.length ? <section className="review-list-section"><div className="review-empty"><strong>Part of the decision inbox could not load.</strong><p>{errors[0]?.message}</p></div></section> : (
        <section className="review-list-section human-decisions-section">
          <HumanDecisionInbox catalogue={catalogue} printing={printing} proposals={agentProposals} sales={sales} />
        </section>
      )}
    </main>
  );
}
