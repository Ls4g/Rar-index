export type EditionMatchTarget = {
  title: string | null;
  series: string | null;
  volume_number: string | number | null;
  language: string | null;
  isbn_13: string | null;
  publisher?: string | null;
};

export type EditionMatchCandidate = {
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  isbn_13: string | null;
  publisher: string | null;
};

export type EditionMatchAssessment = {
  score: number;
  confidence: "strong" | "partial" | "insufficient" | "conflict";
  reasons: string[];
  conflicts: string[];
};

function normalise(value: string | number | null | undefined) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normaliseIsbn(value: string | null | undefined) {
  return String(value ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

function titleMatches(left: string | null, right: string | null) {
  const a = normalise(left);
  const b = normalise(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

export function assessEditionMatch(target: EditionMatchTarget, candidate: EditionMatchCandidate): EditionMatchAssessment {
  let score = 0;
  const reasons: string[] = [];
  const conflicts: string[] = [];
  const targetIsbn = normaliseIsbn(target.isbn_13);
  const candidateIsbn = normaliseIsbn(candidate.isbn_13);

  if (targetIsbn && candidateIsbn) {
    if (targetIsbn === candidateIsbn) {
      score += 60;
      reasons.push("ISBN matches");
    } else {
      conflicts.push("ISBN conflicts with the selected edition");
    }
  } else {
    reasons.push("ISBN not supplied by the listing");
  }

  const targetLanguage = normalise(target.language);
  const candidateLanguage = normalise(candidate.language);
  if (targetLanguage && candidateLanguage) {
    if (targetLanguage === candidateLanguage) {
      score += 15;
      reasons.push("language matches");
    } else {
      conflicts.push("language conflicts with the selected edition");
    }
  } else {
    reasons.push("language not supplied by the listing");
  }

  if (titleMatches(target.title, candidate.title) || titleMatches(target.series, candidate.series)) {
    score += 10;
    reasons.push("title or series is consistent");
  } else {
    reasons.push("title needs human inspection");
  }

  const targetVolume = normalise(target.volume_number);
  const candidateVolume = normalise(candidate.volume_number);
  if (targetVolume && candidateVolume) {
    if (targetVolume === candidateVolume) {
      score += 10;
      reasons.push("volume matches");
    } else {
      conflicts.push("volume conflicts with the selected edition");
    }
  }

  const targetPublisher = normalise(target.publisher);
  const candidatePublisher = normalise(candidate.publisher);
  if (targetPublisher && candidatePublisher && targetPublisher === candidatePublisher) {
    score += 5;
    reasons.push("publisher matches");
  }

  const confidence = conflicts.length
    ? "conflict"
    : score >= 75 ? "strong"
      : score >= 25 ? "partial"
        : "insufficient";
  return { score, confidence, reasons, conflicts };
}
