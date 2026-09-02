import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function recordAgentHumanFeedback(
  admin: SupabaseClient,
  input: {
    workflow: "sale" | "printing" | "catalogue" | "cover" | "scout" | "agent_action";
    subjectKeys: string[];
    outcome: string;
    reasonLabel?: string;
    note?: string;
    reviewedBy: string;
  },
) {
  if (!input.reasonLabel?.trim() && !input.note?.trim()) return;
  const rows = [...new Set(input.subjectKeys)].map((subjectKey) => ({
    workflow: input.workflow,
    subject_key: subjectKey,
    outcome: input.outcome,
    reason_label: input.reasonLabel?.trim() || null,
    note: input.note?.trim() || null,
    reviewed_by: input.reviewedBy.trim(),
  }));
  const { error } = await admin.from("agent_human_feedback").insert(rows);
  // Feedback must never turn a successful human decision into a failure while
  // code and its additive migration are rolling out independently.
  if (error && error.code !== "42P01" && error.code !== "PGRST205") {
    console.error("RAR could not record optional agent feedback", error.message);
  }
}
