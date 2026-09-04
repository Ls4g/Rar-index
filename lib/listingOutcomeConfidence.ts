export type OutcomeConfidenceInput = {
  status: string;
  scheduledEndAt: string | null;
  soldPrice: number | null;
  soldCurrency: string | null;
  soldAt: string | null;
  observationId?: string | null;
  checks: Array<{ provider: string; state: string | null; detail: string | null; checkedAt: string }>;
};

export type OutcomeConfidence = {
  score: number;
  label: string;
  meaning: string;
  signals: string[];
};

function latestCheck(input: OutcomeConfidenceInput) {
  return [...input.checks].sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0] ?? null;
}

function isExplicitProvider(provider: string) {
  return /trading|getitem|marketplace insights/i.test(provider);
}

/**
 * Confidence that RAR understands what happened to the listing.
 *
 * This is deliberately separate from edition matching. A listing can be a
 * perfect match for a book while its sale outcome is completely unknown.
 */
export function assessOutcomeConfidence(input: OutcomeConfidenceInput, now = new Date()): OutcomeConfidence {
  const latest = latestCheck(input);
  const staffObserved = Boolean(latest && /staff observed/i.test(latest.provider));
  const explicitProvider = Boolean(latest && isExplicitProvider(latest.provider));
  const completeSale = input.soldPrice !== null && Boolean(input.soldCurrency && input.soldAt);
  const signals: string[] = [];

  if (input.observationId || input.status === "review_complete") {
    return { score: 100, label: "Confirmed", meaning: "A human completed the outcome review.", signals: ["human decision recorded"] };
  }

  if (input.status === "sold_candidate" && completeSale) {
    if (latest) signals.push(`${latest.provider} reported a completed sale`);
    signals.push("price and date are present");
    return { score: 95, label: "Strong sold signal", meaning: "Sale details are present, but the exact edition still needs human confirmation.", signals };
  }

  if (input.status === "unsold") {
    if (staffObserved) signals.push("staff saw the red ended-without-sale message");
    else if (explicitProvider) signals.push(`${latest?.provider} reported zero sold`);
    else signals.push("human or provider classified the listing as unsold");
    return { score: staffObserved || explicitProvider ? 95 : 85, label: "Strong unsold signal", meaning: "RAR has direct evidence that this listing ended without a sale.", signals };
  }

  if (input.status === "active") {
    if (latest?.state === "active") {
      signals.push(staffObserved ? "staff confirmed the listing is still live" : `${latest.provider} still reports it as active`);
      return { score: staffObserved || explicitProvider ? 95 : 90, label: "Still live", meaning: "The listing is currently active, so it is not a completed sale.", signals };
    }
    return { score: 60, label: "Watching", meaning: "RAR captured this listing while live and is waiting for a later status check.", signals: ["captured as an active listing"] };
  }

  if (latest && staffObserved && latest.state === "completed_sold") {
    return {
      score: 85,
      label: "Sold page observed",
      meaning: "Staff saw eBay's green sold message, but RAR still needs the exact paid price and sale date before it can create evidence.",
      signals: ["green sold styling", "adjacent sold wording", "human observation"],
    };
  }

  if (input.status === "ended_pending_check") {
    const explicitEndPassed = Boolean(input.scheduledEndAt && Date.parse(input.scheduledEndAt) <= now.getTime());
    if (explicitEndPassed) {
      return { score: 45, label: "End time passed", meaning: "eBay supplied an end time, but that alone does not say whether the item sold.", signals: ["scheduled end time passed"] };
    }
    return { score: 20, label: "Status check due", meaning: "RAR has not seen this listing recently. It may still be live and has not been classified as ended.", signals: ["not seen in a recent Scout scan"] };
  }

  if (input.status === "inaccessible") {
    return { score: 10, label: "Outcome unknown", meaning: "The listing is no longer retrievable. Disappearance is not proof of a sale.", signals: ["listing could not be retrieved"] };
  }

  if (input.status === "ambiguous") {
    return { score: latest ? 30 : 15, label: "Outcome unclear", meaning: "Available signals do not prove sold, unsold or still live.", signals: latest ? [`latest check: ${latest.provider}`] : ["no decisive outcome signal"] };
  }

  return { score: 10, label: "Outcome unknown", meaning: "RAR does not yet have a dependable outcome signal.", signals: ["no decisive outcome signal"] };
}
