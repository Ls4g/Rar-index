// Why a scheduled sold-listing search failed, and what each one returned.
//
// Before this existed the daily cron caught every failure in one bare
// `catch {}` and stored nothing: 24 editions were marked failed between 7 and
// 10 November 2026 with last_error null, and the host keeps logs for an hour.
// Every failure now carries a short machine-readable code plus a sentence a
// person can read, and both are stored on the ISBN's search log and in the
// cron summary.
//
// Pure: no network, no database. The Apify calls that raise these live in
// apifySoldSearch.ts; the route writes what this module formats.

export const SEARCH_FAILURE_CODES = [
  "invalid_plan", // RAR could not build a one-edition search
  "edition_missing", // the selected edition could not be read
  "variants_unreadable", // the editions sharing the ISBN could not be read
  "start_http_error", // Apify refused to start the actor run
  "no_run_id", // Apify started something but gave no usable run id
  "poll_http_error", // the run's status could not be read
  "actor_failed", // the actor reported FAILED
  "actor_aborted", // the actor reported ABORTED
  "actor_timed_out", // the actor hit its own timeout
  "not_finished", // still running after every allowed status poll
  "dataset_http_error", // the run's results could not be read
  "invalid_dataset", // the results were not a list
  "request_timeout", // one HTTP request to Apify took too long
  "time_budget", // RAR's own time budget for the cron ran out
  "queue_failed", // results were fetched but could not be queued
  "exception", // anything else
] as const;
export type SearchFailureCode = (typeof SEARCH_FAILURE_CODES)[number];

export const SEARCH_WARNING_CODES = ["charge_ceiling", "cost_unknown"] as const;
export type SearchWarningCode = (typeof SEARCH_WARNING_CODES)[number];

export type SearchProblem<C extends string = string> = { code: C; message: string };

export class SoldSearchFailure extends Error {
  readonly code: SearchFailureCode;
  constructor(code: SearchFailureCode, message: string) {
    super(sanitiseDiagnostic(message));
    this.name = "SoldSearchFailure";
    this.code = code;
  }
}

/**
 * Strip anything that could be a credential before text is stored.
 *
 * The messages RAR writes never include the token (it is only ever sent as a
 * header), but some sentences quote Apify's own status text, so they are
 * scrubbed regardless: bearer values, Apify API tokens, token/key query
 * parameters, and whole URLs (which can carry either).
 */
export function sanitiseDiagnostic(value: unknown, max = 300): string {
  const text = String(value ?? "")
    .replace(/bearer\s+[^\s,;"']+/gi, "Bearer [redacted]")
    .replace(/apify_api_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/\b(token|access_token|api_key|apikey|key|secret|password|authorization)=([^\s&"']+)/gi, "$1=[redacted]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** One stored line: `code: sentence`, bounded, already scrubbed. */
export function formatLastError(problem: SearchProblem, warnings: SearchProblem[] = []): string {
  const parts = [`${problem.code}: ${problem.message}`, ...warnings.map((warning) => `warning ${warning.code}: ${warning.message}`)];
  return sanitiseDiagnostic(parts.join(" | "), 500);
}

/** A succeeded search's warnings, or null when there are none. */
export function formatWarnings(warnings: SearchProblem[]): string | null {
  if (!warnings.length) return null;
  return sanitiseDiagnostic(warnings.map((warning) => `warning ${warning.code}: ${warning.message}`).join(" | "), 500);
}

function isAbortLike(error: unknown) {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}

/** Turn anything thrown during one edition's search into a stored problem. */
export function problemFromError(error: unknown, budgetExpired = false): SearchProblem<SearchFailureCode> {
  if (error instanceof SoldSearchFailure) return { code: error.code, message: error.message };
  if (isAbortLike(error)) {
    return budgetExpired
      ? { code: "time_budget", message: "RAR's time budget for the daily search ran out before this edition finished." }
      : { code: "request_timeout", message: "A request to Apify took too long and was abandoned." };
  }
  const detail = error instanceof Error ? sanitiseDiagnostic(error.message, 160) : "";
  return { code: "exception", message: `An unexpected error stopped this search${detail ? `: ${detail}` : "."}` };
}

export function countInto(counts: Record<string, number>, code: string, by = 1) {
  if (by > 0) counts[code] = (counts[code] ?? 0) + by;
  return counts;
}

export type EditionRunOutcome = {
  editionId: string;
  isbn: string;
  /** Why the scheduler picked it, for the log only. */
  reason: string;
  status: "succeeded" | "failed";
  failure: SearchProblem<SearchFailureCode> | null;
  warnings: SearchProblem<SearchWarningCode>[];
  /** Rows Apify returned that belonged to this search. */
  found: number;
  queued: number;
  alreadyKnown: number;
  needsHuman: number;
  /** Title-search results RAR Auto-Triage closed instead of queueing. */
  autoDismissed: number;
  costUsd: number | null;
  /** Rows dropped individually, by code. */
  dropCounts: Record<string, number>;
  /** eBay item ids whose ISBN covers two printings equally (not queued). */
  ambiguousItemIds: string[];
};

export function failedOutcome(
  target: { editionId: string; isbn: string; reason: string },
  failure: SearchProblem<SearchFailureCode>,
  partial: Partial<Pick<EditionRunOutcome, "costUsd" | "found" | "dropCounts" | "warnings">> = {},
): EditionRunOutcome {
  return {
    editionId: target.editionId, isbn: target.isbn, reason: target.reason,
    status: "failed", failure, warnings: partial.warnings ?? [],
    found: partial.found ?? 0, queued: 0, alreadyKnown: 0, needsHuman: 0, autoDismissed: 0,
    costUsd: partial.costUsd ?? null, dropCounts: partial.dropCounts ?? {}, ambiguousItemIds: [],
  };
}

export const MAX_SUMMARY_AMBIGUOUS_ITEMS = 20;

/**
 * Bounded totals for the cron response and cron_invocations.summary.
 *
 * Holds codes, counts, edition ids, ISBNs and public eBay item ids. No
 * listing payloads and no raw provider responses.
 */
export function summariseRuns(outcomes: EditionRunOutcome[]) {
  const dropCounts: Record<string, number> = {};
  const failureCodes: Record<string, number> = {};
  const warningCodes: Record<string, number> = {};
  let spent = 0;
  let spentKnown = false;
  for (const outcome of outcomes) {
    for (const [code, count] of Object.entries(outcome.dropCounts)) countInto(dropCounts, code, count);
    if (outcome.failure) countInto(failureCodes, outcome.failure.code);
    for (const warning of outcome.warnings) countInto(warningCodes, warning.code);
    if (typeof outcome.costUsd === "number" && Number.isFinite(outcome.costUsd)) {
      spent += outcome.costUsd;
      spentKnown = true;
    }
  }
  const sum = (key: "found" | "queued" | "alreadyKnown" | "needsHuman" | "autoDismissed") =>
    outcomes.reduce((total, outcome) => total + outcome[key], 0);
  const succeeded = outcomes.filter((outcome) => outcome.status === "succeeded").length;
  return {
    searched: outcomes.length,
    succeeded,
    failed: outcomes.length - succeeded,
    found: sum("found"),
    queued: sum("queued"),
    alreadyKnown: sum("alreadyKnown"),
    needsHuman: sum("needsHuman"),
    autoDismissed: sum("autoDismissed"),
    dropped: Object.values(dropCounts).reduce((total, count) => total + count, 0),
    spentUsd: spentKnown ? Math.round(spent * 10_000) / 10_000 : null,
    dropCounts,
    failureCodes,
    warningCodes,
    runs: outcomes.map((outcome) => ({
      edition_id: outcome.editionId,
      isbn: outcome.isbn,
      reason: outcome.reason,
      status: outcome.status,
      code: outcome.failure?.code ?? null,
      error: outcome.failure?.message ?? null,
      warnings: outcome.warnings.map((warning) => warning.code),
      found: outcome.found,
      queued: outcome.queued,
      needs_human: outcome.needsHuman,
      auto_dismissed: outcome.autoDismissed,
      spent_usd: outcome.costUsd,
    })),
    ambiguousPrinting: outcomes.flatMap((outcome) => outcome.ambiguousItemIds.map((itemId) => ({
      isbn: outcome.isbn, item_id: itemId,
    }))).slice(0, MAX_SUMMARY_AMBIGUOUS_ITEMS),
  };
}

export type BoundedRunOptions = {
  concurrency: number;
  /** Epoch ms after which no actor work may continue. */
  deadlineAt: number;
  /** Do not start a new item with less than this left before the deadline. */
  minStartMs: number;
  /** Extra time a started item gets after the deadline to finish queueing. */
  graceMs: number;
  now?: () => number;
};

/**
 * Run items at most `concurrency` at a time, never past the budget.
 *
 * Each item gets its own AbortSignal, aborted when its time is up. An item not
 * started in time, or still running at deadline + grace, resolves through
 * `timedOut` rather than hanging the cron. One item's failure never affects
 * another's result: `work` should not throw, and if it does, `failed` turns
 * the error into that item's own result.
 */
export async function runBounded<I, R>(
  items: I[],
  options: BoundedRunOptions,
  work: (item: I, signal: AbortSignal) => Promise<R>,
  timedOut: (item: I, started: boolean) => R,
  failed: (item: I, error: unknown) => R,
): Promise<R[]> {
  const now = options.now ?? Date.now;
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (options.deadlineAt - now() < options.minStartMs) {
        results[index] = timedOut(item, false);
        continue;
      }
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let expired = false;
      const guard = new Promise<R>((resolve) => {
        timer = setTimeout(() => {
          expired = true;
          controller.abort();
          resolve(timedOut(item, true));
        }, Math.max(0, options.deadlineAt + options.graceMs - now()));
      });
      try {
        const result = await Promise.race([
          work(item, controller.signal).catch((error: unknown) => (expired ? timedOut(item, true) : failed(item, error))),
          guard,
        ]);
        results[index] = result;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency, items.length)) }, lane));
  return results;
}
