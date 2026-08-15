import type { SupabaseClient } from "@supabase/supabase-js";

export type PrintingSuggestion = {
  classification: "first_print_proven" | "known_later_print";
  confidence: number;
  evidenceImageUrl: string;
  printingNumber: number | null;
  rationale: string;
  signals: string[];
};

type SuggestionInput = {
  listingTitle?: string | null;
  rawPayload?: unknown;
};

export type PrintingSuggestionRun = {
  examined: number;
  eligible: number;
  created: number;
  alreadyOpen: number;
  firstPrint: number;
  laterPrint: number;
  ambiguous: number;
};

const FIRST_PRINT_PATTERNS = [
  /\b(?:first|1st)\s+(?:print|printing|impression)\b/i,
  /第\s*1\s*刷/u,
];

const LATER_PRINT_PATTERNS = [
  /\b(2nd|second|3rd|third|(?:[4-9]|[1-9]\d+)(?:th)?)\s+(?:print|printing|impression)\b/i,
  /第\s*([2-9]\d*)\s*刷/u,
];

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validHttpUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function extractEvidenceImageUrl(rawPayload: unknown) {
  const root = asObject(rawPayload);
  if (!root) return null;
  const direct = validHttpUrl(root.evidence_image_url);
  if (direct) return direct;
  const metadata = asObject(root.rar_import_metadata);
  return validHttpUrl(metadata?.evidence_image_url);
}

function laterPrintingNumber(match: RegExpMatchArray | null) {
  const token = match?.[1]?.toLowerCase();
  if (!token) return null;
  if (token === "second" || token === "2nd") return 2;
  if (token === "third" || token === "3rd") return 3;
  const parsed = Number.parseInt(token, 10);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : null;
}

export function assessPrintingEvidenceSuggestion(input: SuggestionInput): PrintingSuggestion | null {
  const title = input.listingTitle?.trim() ?? "";
  const evidenceImageUrl = extractEvidenceImageUrl(input.rawPayload);
  if (!title || !evidenceImageUrl) return null;

  const firstMatch = FIRST_PRINT_PATTERNS.find((pattern) => pattern.test(title));
  const laterMatches = LATER_PRINT_PATTERNS.map((pattern) => title.match(pattern)).filter(Boolean) as RegExpMatchArray[];
  if (firstMatch && laterMatches.length) return null;

  if (firstMatch) {
    return {
      classification: "first_print_proven",
      confidence: 0.9,
      evidenceImageUrl,
      printingNumber: 1,
      rationale: "The listing explicitly claims a first printing and includes a captured copyright-page image. Staff must inspect that image before accepting.",
      signals: ["explicit_first_print_wording", "captured_evidence_image"],
    };
  }

  if (laterMatches.length) {
    const printingNumber = laterPrintingNumber(laterMatches[0]);
    return {
      classification: "known_later_print",
      confidence: printingNumber ? 0.92 : 0.86,
      evidenceImageUrl,
      printingNumber,
      rationale: "The listing explicitly names a later printing and includes a captured copyright-page image. Staff must inspect that image before accepting.",
      signals: ["explicit_later_print_wording", "captured_evidence_image"],
    };
  }

  return null;
}

export async function preparePrintingEvidenceSuggestions(
  admin: SupabaseClient,
  runId: string,
  limit = 100,
): Promise<PrintingSuggestionRun> {
  const { data, error } = await admin
    .from("price_observations")
    .select("id,listing_title,source_listing_url,raw_payload")
    .eq("match_status", "verified_match")
    .eq("sale_status", "confirmed")
    .eq("print_classification", "printing_not_identified")
    .order("sold_date", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`Evidence Auditor could not read printing evidence: ${error.message}`);

  const result: PrintingSuggestionRun = {
    examined: data?.length ?? 0,
    eligible: 0,
    created: 0,
    alreadyOpen: 0,
    firstPrint: 0,
    laterPrint: 0,
    ambiguous: 0,
  };

  for (const row of data ?? []) {
    const suggestion = assessPrintingEvidenceSuggestion({ listingTitle: row.listing_title, rawPayload: row.raw_payload });
    if (!suggestion) {
      if (extractEvidenceImageUrl(row.raw_payload) && /(?:first|1st|print|printing|第\s*\d+\s*刷)/iu.test(row.listing_title ?? "")) result.ambiguous += 1;
      continue;
    }
    result.eligible += 1;
    if (suggestion.classification === "first_print_proven") result.firstPrint += 1;
    else result.laterPrint += 1;

    const { error: insertError } = await admin.from("agent_actions").insert({
      run_id: runId,
      agent_key: "evidence_auditor",
      action_type: "suggest_print_classification",
      target_type: "price_observations",
      target_id: row.id,
      dedupe_key: `evidence:printing-suggestion:${row.id}`,
      title: suggestion.classification === "first_print_proven" ? "Check likely first-print proof" : "Check likely later-print proof",
      rationale: suggestion.rationale,
      risk_level: "medium",
      confidence: suggestion.confidence,
      evidence: {
        listing_title: row.listing_title,
        source_listing_url: row.source_listing_url,
        evidence_image_url: suggestion.evidenceImageUrl,
        signals: suggestion.signals,
      },
      proposed_payload: {
        classification: suggestion.classification,
        printing_number: suggestion.printingNumber,
        proof_url: suggestion.evidenceImageUrl,
      },
    });
    if (!insertError) result.created += 1;
    else if (insertError.code === "23505") result.alreadyOpen += 1;
    else throw new Error(`Evidence Auditor could not prepare a suggestion: ${insertError.message}`);
  }

  return result;
}
