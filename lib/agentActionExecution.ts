export type AgentActionExecutionKind = "scan_stale_profiles" | "shadow_test_rule";

export function agentActionExecutionKind(actionType: string): AgentActionExecutionKind | null {
  if (actionType === "scan_stale_profiles") return "scan_stale_profiles";
  if (actionType.startsWith("shadow_test_")) return "shadow_test_rule";
  return null;
}

export function isExecutableAgentAction(actionType: string) {
  return agentActionExecutionKind(actionType) !== null;
}
