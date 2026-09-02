export type AgentActionExecutionKind = "scan_stale_profiles" | "shadow_test_rule";

export type ExecutableAgentAction = {
  id: string;
  action_type: string;
  status: string;
  target_type: string;
  target_id: string | null;
  evidence: Record<string, unknown> | null;
  proposed_payload: Record<string, unknown> | null;
};

export type AgentActionPreflight = {
  ok: boolean;
  executionKind: AgentActionExecutionKind | null;
  checks: Array<{ key: string; passed: boolean; message: string }>;
};

export function agentActionExecutionKind(actionType: string): AgentActionExecutionKind | null {
  if (actionType === "scan_stale_profiles") return "scan_stale_profiles";
  if (actionType.startsWith("shadow_test_")) return "shadow_test_rule";
  return null;
}

export function isExecutableAgentAction(actionType: string) {
  return agentActionExecutionKind(actionType) !== null;
}

export function preflightAgentAction(action: ExecutableAgentAction): AgentActionPreflight {
  const executionKind = agentActionExecutionKind(action.action_type);
  const checks = [
    { key: "still_proposed", passed: action.status === "proposed", message: "The proposal is still awaiting a human decision." },
    { key: "known_execution", passed: executionKind !== null, message: "RAR has a defined execution contract for this action." },
    { key: "target_present", passed: Boolean(action.target_type?.trim()), message: "The proposal names the data boundary it may affect." },
    { key: "evidence_present", passed: Boolean(action.evidence && Object.keys(action.evidence).length), message: "The proposal carries evidence for the human decision." },
  ];
  if (executionKind === "scan_stale_profiles") {
    checks.push({ key: "scan_scope", passed: action.target_type === "marketplace_search_profiles", message: "The scan is limited to marketplace search profiles." });
  }
  if (executionKind === "shadow_test_rule") {
    checks.push({ key: "shadow_only", passed: action.action_type.startsWith("shadow_test_"), message: "The rule can only run as a shadow test; activation remains separate." });
  }
  return { ok: checks.every((check) => check.passed), executionKind, checks };
}
