import { isExecutableAgentAction } from "./agentActionExecution.ts";

// Who an agent action is actually for.
//
// Every proposal used to be shown to staff with an Approve button, but most
// of them did nothing when approved: "Investigate 35 watched leads now scored
// as conflicts" was a debugging task for whoever maintains the scorer, filed
// as "planned" and then cleared with "Mark done". Staff were approving work
// nobody would do. (Raised by the owner on 16 Nov 2026: "I just approve then
// mark them as done... I don't actually do anything.")
//
//   decision  - approving runs something (a profile scan, a shadow test), or
//               the type is unknown (kept visible rather than hidden).
//   developer - a code or scorer investigation. Shown as a read-only list
//               for whoever maintains RAR; no approve button.
//   reminder  - "go and work this queue": the queue itself is already in
//               Decisions or Scout, so the reminder is noise there.

export type AgentActionAudience = "decision" | "developer" | "reminder";

const DEVELOPER = new Set([
  "review_scout_feedback_conflicts",
  "review_scout_feedback_recall",
  "review_scout_feedback_precision",
  "review_scout_rule_regression",
  "tune_low_yield_profiles",
  "investigate_agent_failures",
  "resolve_readiness_bottleneck",
]);

const REMINDER = new Set([
  "review_catalogue_queue",
  "research_catalogue_requests",
  "source_missing_covers",
  "triage_scout_leads",
  "review_sales_evidence",
  "classify_printing_evidence",
  "review_community_reports",
]);

export function agentActionAudience(actionType: string): AgentActionAudience {
  if (isExecutableAgentAction(actionType)) return "decision";
  if (DEVELOPER.has(actionType)) return "developer";
  if (REMINDER.has(actionType)) return "reminder";
  return "decision";
}
