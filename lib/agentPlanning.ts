export const AGENT_KEYS = [
  "catalogue_curator",
  "market_scout",
  "evidence_auditor",
  "rar_operator",
] as const;

export type AgentKey = (typeof AGENT_KEYS)[number];

export type AgentProposal = {
  actionType: string;
  targetType: string;
  targetId?: string;
  dedupeKey: string;
  title: string;
  rationale: string;
  riskLevel: "low" | "medium" | "high";
  confidence: number;
  evidence: Record<string, unknown>;
  proposedPayload?: Record<string, unknown>;
};

export type AgentPlan = {
  summary: string;
  proposals: AgentProposal[];
};

export type AgentMetrics = Record<string, number>;

export const AGENT_LABELS: Record<AgentKey, string> = {
  catalogue_curator: "Catalogue Curator",
  market_scout: "Market Scout",
  evidence_auditor: "Evidence Auditor",
  rar_operator: "RAR Operator",
};

export function isAgentKey(value: unknown): value is AgentKey {
  return typeof value === "string" && (AGENT_KEYS as readonly string[]).includes(value);
}

function proposal(
  actionType: string,
  targetType: string,
  dedupeKey: string,
  title: string,
  rationale: string,
  confidence: number,
  evidence: Record<string, unknown>,
): AgentProposal {
  return { actionType, targetType, dedupeKey, title, rationale, riskLevel: "low", confidence, evidence };
}

export function planAgentActions(agentKey: AgentKey, metrics: AgentMetrics): AgentPlan {
  const proposals: AgentProposal[] = [];

  if (agentKey === "catalogue_curator") {
    if (metrics.catalogue_queue_pending > 0) {
      proposals.push(proposal(
        "review_catalogue_queue",
        "catalogue_import_queue",
        "catalogue:review-pending-imports",
        `Review ${metrics.catalogue_queue_pending} catalogue candidates`,
        "These records are staged but cannot become editions until a human checks their identity.",
        0.98,
        metrics,
      ));
    }
    if (metrics.catalogue_requests_pending > 0) {
      proposals.push(proposal(
        "research_catalogue_requests",
        "catalogue_requests",
        "catalogue:research-public-requests",
        `Research ${metrics.catalogue_requests_pending} public catalogue requests`,
        "Collectors have requested records that are not yet resolved in the catalogue.",
        0.95,
        metrics,
      ));
    }
    if (metrics.verified_editions_missing_covers > 0) {
      proposals.push(proposal(
        "source_missing_covers",
        "manga_editions",
        "catalogue:source-missing-covers",
        `Source ${metrics.verified_editions_missing_covers} missing verified covers`,
        "Verified editions without verified covers weaken catalogue usability and discovery.",
        0.95,
        metrics,
      ));
    }
    return {
      summary: metrics.catalogue_discovery_targets
        ? `Searched ${metrics.catalogue_targets_searched ?? 0} catalogue target${metrics.catalogue_targets_searched === 1 ? "" : "s"}; staged ${metrics.catalogue_candidates_staged ?? 0} ISBN-backed candidate${metrics.catalogue_candidates_staged === 1 ? "" : "s"} for human review. ${proposals.length} catalogue workstream${proposals.length === 1 ? "" : "s"} now need attention.`
        : proposals.length
          ? `Found ${proposals.length} catalogue workstream${proposals.length === 1 ? "" : "s"} needing attention.`
          : "Catalogue intake, requests and verified-cover coverage have no open gaps.",
      proposals,
    };
  }

  if (agentKey === "market_scout") {
    if (metrics.scout_review_now > 0) {
      proposals.push(proposal(
        "triage_scout_leads",
        "scout_listing_leads",
        "scout:triage-new-leads",
        `Review ${metrics.scout_review_now} current, plausible marketplace leads`,
        "These leads were seen recently, score at least 50 and have not received a staff watch-or-dismiss decision.",
        0.99,
        metrics,
      ));
    }
    if (metrics.scout_profiles_needing_tuning > 0) {
      proposals.push(proposal(
        "tune_low_yield_profiles",
        "marketplace_search_profiles",
        "scout:tune-low-yield-profiles",
        `Tune ${metrics.scout_profiles_needing_tuning} low-yield search profiles`,
        "Each profile has produced at least ten leads but fewer than one in four scores high enough for the current review queue.",
        0.96,
        metrics,
      ));
    }
    if (metrics.stale_search_profiles > 0) {
      proposals.push(proposal(
        "scan_stale_profiles",
        "marketplace_search_profiles",
        "scout:scan-stale-profiles",
        `Refresh ${metrics.stale_search_profiles} stale search profiles`,
        "These active profiles have never been checked or are past their configured collection interval.",
        0.97,
        metrics,
      ));
    }
    return {
      summary: `${metrics.auto_dismissed_leads ?? 0} conflicts dismissed; ${metrics.availability_archived ?? 0} unavailable listings archived; ${metrics.scout_review_now ?? 0} current plausible leads need people; ${metrics.scout_stale_backlog ?? 0} stale leads are separated from the default queue.`,
      proposals,
    };
  }

  if (agentKey === "evidence_auditor") {
    if (metrics.sales_needing_review > 0) {
      proposals.push(proposal(
        "review_sales_evidence",
        "price_observations",
        "evidence:review-sales",
        `Review ${metrics.sales_needing_review} sale records`,
        "These sale observations are excluded from verified values until a human confirms the edition match.",
        0.99,
        metrics,
      ));
    }
    if (metrics.sales_with_print_proof_waiting > 0) {
      proposals.push(proposal(
        "classify_printing_evidence",
        "price_observations",
        "evidence:classify-printing",
        `Check ${metrics.sales_with_print_proof_waiting} sales with captured printing proof`,
        `${metrics.printing_suggestions_open ?? 0} cautious Evidence Auditor suggestion${metrics.printing_suggestions_open === 1 ? " is" : "s are"} ready. A person must inspect each copyright-page image before accepting it.`,
        0.98,
        metrics,
      ));
    }
    if (metrics.community_reports_pending > 0) {
      proposals.push(proposal(
        "review_community_reports",
        "community_sale_reports",
        "evidence:review-community-reports",
        `Review ${metrics.community_reports_pending} community reports`,
        "Community evidence remains a lead until staff checks its source and exact edition.",
        0.98,
        metrics,
      ));
    }
    return {
      summary: proposals.length
        ? `Prepared ${metrics.printing_suggestions_created ?? 0} new printing suggestion${metrics.printing_suggestions_created === 1 ? "" : "s"}; found ${proposals.length} evidence queue${proposals.length === 1 ? "" : "s"} requiring human judgement.`
        : "Sales, print classification and community-report queues are clear.",
      proposals,
    };
  }

  const bottlenecks = Object.entries(metrics)
    .filter(([key, value]) => key.startsWith("readiness_") && value > 0)
    .sort((left, right) => right[1] - left[1]);
  if (bottlenecks.length) {
    const [largestKey, largestCount] = bottlenecks[0];
    const readable = largestKey.replace("readiness_", "").replaceAll("_", " ");
    proposals.push(proposal(
      "resolve_readiness_bottleneck",
      "edition_readiness",
      `operator:readiness:${largestKey}`,
      `Resolve the largest readiness bottleneck: ${readable}`,
      `${largestCount} catalogue records currently share this blocked state. The operator is surfacing it for prioritisation, not changing the records.`,
      0.94,
      { bottleneck: readable, count: largestCount, ...metrics },
    ));
  }
  if (metrics.failed_agent_runs_24h > 0) {
    proposals.push(proposal(
      "investigate_agent_failures",
      "agent_runs",
      "operator:investigate-agent-failures",
      `Investigate ${metrics.failed_agent_runs_24h} failed agent runs`,
      "Recent agent failures could make operational summaries incomplete and should be resolved before expanding autonomy.",
      1,
      metrics,
    ));
  }
  if (metrics.open_agent_incidents > 0) {
    proposals.push(proposal(
      "resolve_agent_incidents",
      "agent_incidents",
      "operator:resolve-agent-incidents",
      `Resolve ${metrics.open_agent_incidents} open automation incident${metrics.open_agent_incidents === 1 ? "" : "s"}`,
      "Phase 5 has grouped recent failures and safety stops into one exception queue. Review the cause before resolving or resuming automation.",
      1,
      metrics,
    ));
  }
  return {
    summary: proposals.length
      ? `Operator found ${proposals.length} system-level priority${proposals.length === 1 ? "" : "ies"}; ${metrics.safe_agent_actions_24h ?? 0} safe actions executed and ${metrics.open_agent_proposals ?? 0} proposals remain open.`
      : `${metrics.safe_agent_actions_24h ?? 0} safe actions executed in 24 hours; no edition-readiness bottleneck or recent agent failure needs escalation.`,
    proposals,
  };
}
