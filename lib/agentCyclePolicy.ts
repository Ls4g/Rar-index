import type { AgentKey } from "./agentPlanning.ts";

export type CycleAgentResult = {
  agentKey: AgentKey;
  ok: boolean;
  status: string;
  summary?: string | null;
  error?: string;
};

export function summarizeAgentCycleResults(results: CycleAgentResult[]) {
  const successful = results.filter((item) => item.ok && item.status === "succeeded").length;
  const blocked = results.filter((item) => item.ok && item.status === "blocked").length;
  const failed = results.length - successful - blocked;
  const failedNames = results.filter((item) => !item.ok || item.status === "failed").map((item) => item.agentKey.replaceAll("_", " "));
  const summary = failed
    ? `${failed} agent${failed === 1 ? "" : "s"} failed: ${failedNames.join(", ")}. ${successful} succeeded and ${blocked} were blocked.`
    : blocked
      ? `${blocked} agent${blocked === 1 ? " was" : "s were"} blocked by the safety controls; ${successful} completed.`
      : `All ${successful} RAR agents completed successfully.`;
  return { successful, failed, blocked, summary };
}

export function shouldTripCircuitBreaker(consecutiveFailures: number, threshold: number, failedAgents: number) {
  return failedAgents > 0 && consecutiveFailures + 1 >= threshold;
}
