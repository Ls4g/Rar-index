import { assessEditionMatch, type EditionMatchAssessment, type EditionMatchCandidate, type EditionMatchTarget } from "./editionMatch.ts";

export type PriceImportEdition = EditionMatchTarget & {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | number | null;
  language: string | null;
  isbn_13: string | null;
  publisher: string | null;
  format?: string | null;
};

export type EditionResolutionSuggestion = {
  edition: PriceImportEdition;
  match: EditionMatchAssessment;
};

export type EditionResolution =
  | {
    status: "resolved";
    edition: PriceImportEdition;
    match: EditionMatchAssessment;
    method: "selected" | "isbn" | "ranked";
    suggestions: EditionResolutionSuggestion[];
  }
  | {
    status: "blocked";
    issue: string;
    suggestions: EditionResolutionSuggestion[];
  };

function normaliseIsbn(value: string | null | undefined) {
  return String(value ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

function rankedSuggestions(editions: PriceImportEdition[], candidate: EditionMatchCandidate) {
  return editions
    .map((edition) => ({ edition, match: assessEditionMatch(edition, candidate) }))
    .filter((item) => item.match.score > 0 && item.match.conflicts.length === 0)
    .sort((left, right) => right.match.score - left.match.score || left.edition.id.localeCompare(right.edition.id));
}

/**
 * Suggests one existing RAR edition without ever asserting that the match is
 * verified. A resolved result is only an inbox destination: the observation
 * remains needs_review until a human checks the original sale evidence.
 */
export function resolvePriceImportEdition(
  editions: PriceImportEdition[],
  candidate: EditionMatchCandidate,
  selectedEdition?: PriceImportEdition | null,
): EditionResolution {
  if (selectedEdition) {
    const match = assessEditionMatch(selectedEdition, candidate);
    if (match.conflicts.length) {
      return {
        status: "blocked",
        issue: `candidate conflicts with the selected edition: ${match.conflicts.join("; ")}`,
        suggestions: [{ edition: selectedEdition, match }],
      };
    }
    return { status: "resolved", edition: selectedEdition, match, method: "selected", suggestions: [{ edition: selectedEdition, match }] };
  }

  const candidateIsbn = normaliseIsbn(candidate.isbn_13);
  if (candidateIsbn) {
    const isbnMatches = editions.filter((edition) => normaliseIsbn(edition.isbn_13) === candidateIsbn);
    const rankedIsbnMatches = rankedSuggestions(isbnMatches, candidate);
    if (rankedIsbnMatches.length === 1) {
      const winner = rankedIsbnMatches[0];
      return { status: "resolved", ...winner, method: "isbn", suggestions: rankedIsbnMatches };
    }
    if (rankedIsbnMatches.length > 1) {
      return {
        status: "blocked",
        issue: "ISBN matches more than one RAR edition; select the exact edition before queueing this row",
        suggestions: rankedIsbnMatches.slice(0, 5),
      };
    }
  }

  const suggestions = rankedSuggestions(editions, candidate).slice(0, 5);
  const winner = suggestions[0];
  if (!winner || winner.match.score < 50) {
    return {
      status: "blocked",
      issue: "RAR could not suggest an edition confidently enough; add an ISBN or choose one exact edition for the batch",
      suggestions,
    };
  }

  const runnerUp = suggestions[1];
  if (runnerUp && winner.match.score - runnerUp.match.score < 15) {
    return {
      status: "blocked",
      issue: "more than one RAR edition is plausible; choose one exact edition for this batch",
      suggestions,
    };
  }

  return { status: "resolved", ...winner, method: "ranked", suggestions };
}
