import {
  classifyListingOutcome,
  outcomeMatchesQueue,
  type OutcomeQueue,
  type TriageableOutcome,
} from "./listingOutcomeTriage.ts";

export type OutcomeView = "attention" | "watching" | "finished";
export type OutcomeSort = "priority" | "match" | "newest";

/**
 * The fields needed to decide where an outcome belongs and whether it matches
 * what the reviewer asked for. Deliberately much smaller than the row the page
 * renders: the whole table has to be classified to produce honest counts and
 * stable pages, but only the current page needs its full detail loaded.
 */
export type BrowsableOutcome = TriageableOutcome & {
  id: string;
  externalId: string;
  editionLabel: string;
  reviewedBy: string | null;
  checkAttempts: number;
};

export const OUTCOME_PAGE_SIZE = 25;
export const OUTCOME_VIEWS: OutcomeView[] = ["attention", "watching", "finished"];
export const OUTCOME_QUEUES: OutcomeQueue[] = [
  "worth_checking", "best_offer", "high_value", "conflict", "graded", "lot", "parked", "all",
];
export const OUTCOME_SORTS: OutcomeSort[] = ["priority", "match", "newest"];

/**
 * Which tab an outcome belongs to.
 *
 * An ended_pending_check row that has never actually been checked goes to
 * "watching", not "attention": RAR has not looked at the listing since queueing
 * it, so it has nothing to tell a human and no question to ask. Without this
 * the review tab filled with hundreds of "should RAR keep watching?" prompts
 * about listings that were plainly still live.
 */
export function outcomeView(row: Pick<BrowsableOutcome, "status" | "reviewedBy" | "checkAttempts">): OutcomeView {
  if (row.reviewedBy || ["unsold", "review_complete"].includes(row.status)) return "finished";
  if (row.status === "active") return "watching";
  if (row.status === "ended_pending_check" && row.checkAttempts === 0) return "watching";
  return "attention";
}

function searchText(row: BrowsableOutcome) {
  return `${row.listingTitle} ${row.editionLabel} ${row.externalId}`.toLocaleLowerCase();
}

export function outcomeMatchesSearch(row: BrowsableOutcome, search: string) {
  const needle = search.trim().toLocaleLowerCase();
  return !needle || searchText(row).includes(needle);
}

/**
 * Order rows for display.
 *
 * Every comparison ends in a tiebreak on id. Two rows with an equal sort key
 * would otherwise keep whatever order the database happened to return, and a
 * page boundary falling between them could show the same row twice or skip one
 * entirely as the underlying order shifted between requests.
 */
export function sortOutcomes(rows: BrowsableOutcome[], sort: OutcomeSort, now = new Date()) {
  const priority = new Map(rows.map((row) => [row.id, classifyListingOutcome(row, now).priority]));
  return [...rows].sort((a, b) => {
    if (sort === "match") {
      const difference = (b.matchScore ?? -1) - (a.matchScore ?? -1);
      if (difference) return difference;
    } else if (sort === "newest") {
      const difference = Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt);
      if (difference) return difference;
    } else {
      const difference = (priority.get(b.id) ?? 0) - (priority.get(a.id) ?? 0);
      if (difference) return difference;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function normaliseView(value: unknown): OutcomeView {
  return OUTCOME_VIEWS.includes(value as OutcomeView) ? value as OutcomeView : "attention";
}

export function normaliseQueue(value: unknown): OutcomeQueue {
  return OUTCOME_QUEUES.includes(value as OutcomeQueue) ? value as OutcomeQueue : "worth_checking";
}

export function normaliseSort(value: unknown): OutcomeSort {
  return OUTCOME_SORTS.includes(value as OutcomeSort) ? value as OutcomeSort : "priority";
}

export function normalisePage(value: unknown) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
}

export type OutcomeBrowseRequest = {
  rows: BrowsableOutcome[];
  view?: OutcomeView;
  queue?: OutcomeQueue;
  search?: string;
  sort?: OutcomeSort;
  page?: number;
  pageSize?: number;
  now?: Date;
  /** Keep this outcome reachable: the page containing it is served instead. */
  focusId?: string | null;
};

export type OutcomeBrowseResult = {
  view: OutcomeView;
  queue: OutcomeQueue;
  sort: OutcomeSort;
  search: string;
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  firstIndex: number;
  lastIndex: number;
  pageRows: BrowsableOutcome[];
  viewCounts: Record<OutcomeView, number>;
  queueCounts: Record<OutcomeQueue, number>;
  /** True when the focused outcome decided the view, queue or page served. */
  focusRedirected: boolean;
  /** Set when a focus id was asked for but matches no row at all. */
  focusMissing: boolean;
};

/**
 * Turn the whole classified table into one page the reviewer asked for, plus
 * the counts that describe everything they did not ask for.
 *
 * Counts are computed over every row rather than over the page, because the
 * point of this function is that no outcome is unreachable or uncounted. The
 * earlier page capped its queries at 200/75/25 rows and then derived its tab
 * and queue counts from that sample, so the numbers staff saw were a floor,
 * not a total, and 1506 rows could not be opened at all.
 */
export function browseOutcomes(request: OutcomeBrowseRequest): OutcomeBrowseResult {
  const now = request.now ?? new Date();
  const pageSize = Math.max(1, request.pageSize ?? OUTCOME_PAGE_SIZE);
  const search = request.search?.trim() ?? "";
  const sort = request.sort ?? "priority";

  const byView = new Map<OutcomeView, BrowsableOutcome[]>(OUTCOME_VIEWS.map((view) => [view, []]));
  for (const row of request.rows) byView.get(outcomeView(row))!.push(row);
  const viewCounts = Object.fromEntries(OUTCOME_VIEWS.map((view) => [view, byView.get(view)!.length])) as Record<OutcomeView, number>;

  const focusRow = request.focusId ? request.rows.find((row) => row.id === request.focusId) ?? null : null;
  const focusMissing = Boolean(request.focusId) && !focusRow;

  // A link from the Decisions page names one exact listing. Serve the view and
  // queue that actually contain it, rather than the reviewer's last filter,
  // which would hide the very listing the link was about.
  let view = request.view ?? "attention";
  let queue = request.queue ?? "worth_checking";
  let focusRedirected = false;
  if (focusRow) {
    const focusView = outcomeView(focusRow);
    if (focusView !== view) { view = focusView; focusRedirected = true; }
    if (view === "attention" && !outcomeMatchesQueue(focusRow, queue, now)) { queue = "all"; focusRedirected = true; }
  }

  const scoped = (byView.get(view) ?? []).filter((row) => outcomeMatchesSearch(row, search));
  const queueCounts = Object.fromEntries(OUTCOME_QUEUES.map((key) => [
    key,
    view === "attention" ? scoped.filter((row) => outcomeMatchesQueue(row, key, now)).length : scoped.length,
  ])) as Record<OutcomeQueue, number>;

  const matching = view === "attention"
    ? scoped.filter((row) => outcomeMatchesQueue(row, queue, now))
    : scoped;
  const ordered = sortOutcomes(matching, sort, now);
  const total = ordered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  let page = Math.min(Math.max(1, request.page ?? 1), pageCount);
  if (focusRow) {
    const position = ordered.findIndex((row) => row.id === focusRow.id);
    if (position >= 0) {
      const focusPage = Math.floor(position / pageSize) + 1;
      if (focusPage !== page) { page = focusPage; focusRedirected = true; }
    }
  }

  const start = (page - 1) * pageSize;
  const pageRows = ordered.slice(start, start + pageSize);

  return {
    view,
    queue,
    sort,
    search,
    page,
    pageSize,
    pageCount,
    total,
    firstIndex: total ? start + 1 : 0,
    lastIndex: total ? start + pageRows.length : 0,
    pageRows,
    viewCounts,
    queueCounts,
    focusRedirected,
    focusMissing,
  };
}
