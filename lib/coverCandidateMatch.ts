export type CoverMatchTarget = {
  title: string | null;
  series: string | null;
  volumeNumber: string | number | null;
  language: string | null;
  publisher: string | null;
  isbn13: string | null;
};

export type CoverMatchCandidate = {
  title: string | null;
  language: string | null;
  publisher: string | null;
  isbn13: string | null;
};

export type CoverCandidateAssessment = {
  score: number;
  confidence: "strong" | "partial" | "conflict" | "insufficient";
  eligible: boolean;
  reasons: string[];
  conflicts: string[];
};

function compact(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeIsbn(value: string | null | undefined) {
  return (value ?? "").toUpperCase().replace(/[^0-9X]/g, "");
}

function normalizeLanguage(value: string | null | undefined) {
  const normalized = compact(value);
  if (["ja", "jpn", "japanese"].includes(normalized)) return "ja";
  if (["en", "eng", "english"].includes(normalized)) return "en";
  return normalized;
}

function detectVolume(value: string | null | undefined) {
  const normalized = compact(value);
  const explicit = normalized.match(/(?:vol|volume|book)\s*0*(\d{1,3})\b/);
  if (explicit) return Number(explicit[1]);
  const trailing = normalized.match(/\b0*(\d{1,3})$/);
  return trailing ? Number(trailing[1]) : null;
}

function titleMatches(target: CoverMatchTarget, candidate: CoverMatchCandidate) {
  const candidateTitle = compact(candidate.title);
  const targetTitle = compact(target.title);
  const targetSeries = compact(target.series);
  if (!candidateTitle) return false;
  return Boolean(
    (targetTitle && (candidateTitle.includes(targetTitle) || targetTitle.includes(candidateTitle)))
    || (targetSeries && candidateTitle.includes(targetSeries)),
  );
}

function publisherMatches(target: string | null, candidate: string | null) {
  const targetPublisher = compact(target);
  const candidatePublisher = compact(candidate);
  if (!targetPublisher || !candidatePublisher) return false;
  return targetPublisher.includes(candidatePublisher) || candidatePublisher.includes(targetPublisher);
}

export function assessCoverCandidate(target: CoverMatchTarget, candidate: CoverMatchCandidate): CoverCandidateAssessment {
  const reasons: string[] = [];
  const conflicts: string[] = [];
  let score = 0;

  const targetIsbn = normalizeIsbn(target.isbn13);
  const candidateIsbn = normalizeIsbn(candidate.isbn13);
  if (!targetIsbn || !candidateIsbn) {
    conflicts.push("Exact ISBN is unavailable");
  } else if (targetIsbn !== candidateIsbn) {
    conflicts.push("ISBN conflicts with the RAR edition");
  } else {
    score += 60;
    reasons.push("Exact ISBN match");
  }

  if (titleMatches(target, candidate)) {
    score += 20;
    reasons.push("Title or series match");
  }

  const targetVolume = target.volumeNumber == null ? null : Number(target.volumeNumber);
  const candidateVolume = detectVolume(candidate.title);
  if (Number.isFinite(targetVolume) && candidateVolume != null) {
    if (targetVolume === candidateVolume) {
      score += 10;
      reasons.push("Volume match");
    } else {
      conflicts.push(`Candidate names volume ${candidateVolume}, not volume ${targetVolume}`);
    }
  }

  const targetLanguage = normalizeLanguage(target.language);
  const candidateLanguage = normalizeLanguage(candidate.language);
  if (targetLanguage && candidateLanguage) {
    if (targetLanguage === candidateLanguage) {
      score += 5;
      reasons.push("Language match");
    } else {
      conflicts.push("Language conflicts with the RAR edition");
    }
  }

  if (publisherMatches(target.publisher, candidate.publisher)) {
    score += 5;
    reasons.push("Publisher match");
  } else if (target.publisher && candidate.publisher) {
    reasons.push("Publisher needs human confirmation");
  }

  const exactIsbn = Boolean(targetIsbn && candidateIsbn && targetIsbn === candidateIsbn);
  const eligible = exactIsbn && conflicts.length === 0 && score >= 60;
  const confidence: CoverCandidateAssessment["confidence"] = conflicts.length
    ? "conflict"
    : !eligible
      ? "insufficient"
      : score >= 85
        ? "strong"
        : "partial";

  return { score, confidence, eligible, reasons, conflicts };
}
