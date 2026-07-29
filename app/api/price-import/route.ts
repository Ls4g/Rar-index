import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { assessEditionMatch, type EditionMatchAssessment } from "@/lib/editionMatch";

const REQUIRED_HEADERS = [
  "source_id",
  "external_id",
  "source_listing_url",
  "listing_title",
  "sale_status",
  "sale_type",
  "sold_date",
  "sale_price",
  "currency",
  "shipping_price",
  "evidence_image_url",
  "raw_payload",
  "candidate_title",
  "candidate_series",
  "candidate_volume_number",
  "candidate_language",
  "candidate_isbn_13",
  "candidate_publisher",
  "candidate_format",
] as const;

const MAX_ROWS = 500;
const MAX_CSV_CHARACTERS = 1_500_000;

type Source = { id: string; name: string | null };
type Edition = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | number | null;
  language: string | null;
  isbn_13: string | null;
  publisher: string | null;
  printing_number: number | null;
  edition_statement: string | null;
  variant_name: string | null;
};

type CollectionRun = { id: string; profile_id: string };

type CsvRow = Record<string, string>;
type ReportRow = {
  rowNumber: number;
  status: "ready" | "duplicate" | "blocked";
  issues: string[];
  source: string;
  externalId: string;
  listingTitle: string;
  soldDate: string;
  price: string;
  currency: string;
  evidenceImageUrl: string;
  match: EditionMatchAssessment | null;
};

type PreparedSale = {
  rowNumber: number;
  sourceId: string;
  externalId: string;
  sourceListingUrl: string;
  listingTitle: string;
  soldDate: string;
  salePrice: number;
  saleType: "auction" | "best_offer" | "fixed_price" | "unknown";
  currency: string;
  shippingPrice: number | null;
  itemCondition: string | null;
  isSealed: boolean;
  evidenceImageUrl: string | null;
  rawPayload: Record<string, unknown>;
  candidate: Record<string, string | null>;
  match: EditionMatchAssessment;
};

function isStaffRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  const username = process.env.RAR_REVIEW_USERNAME;
  const password = process.env.RAR_REVIEW_PASSWORD;

  if (!username || !password || !authorization?.startsWith("Basic ")) return false;

  try {
    const [providedUsername, providedPassword] = atob(authorization.slice(6)).split(":");
    return providedUsername === username && providedPassword === password;
  } catch {
    return false;
  }
}

function clean(value: string | undefined) {
  return (value ?? "").trim();
}

function sourceKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sourceForValue(value: string, sources: Source[]) {
  const normalized = sourceKey(value);
  if (!normalized) return null;

  const matches = sources.filter((source) => {
    const name = sourceKey(source.name ?? "");
    return source.id === value || name === normalized || name.startsWith(normalized) || normalized.startsWith(name);
  });

  return matches.length === 1 ? matches[0] : null;
}

function parseCsv(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("The CSV has an unclosed quoted value.");
  row.push(field.replace(/\r$/, ""));
  rows.push(row);

  const nonBlankRows = rows.filter((values) => values.some((value) => value.trim()));
  if (!nonBlankRows.length) throw new Error("The CSV is empty.");

  const headers = nonBlankRows[0].map((header) => header.replace(/^\uFEFF/, "").trim());
  const duplicateHeader = headers.find((header, index) => headers.indexOf(header) !== index);
  if (duplicateHeader) throw new Error(`The CSV contains the header \"${duplicateHeader}\" more than once.`);

  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length) throw new Error(`Missing required CSV header${missingHeaders.length === 1 ? "" : "s"}: ${missingHeaders.join(", ")}.`);
  if (nonBlankRows.length - 1 > MAX_ROWS) throw new Error(`A batch can contain at most ${MAX_ROWS} rows.`);

  const records = nonBlankRows.slice(1).map((values, index) => {
    const record: CsvRow = {};
    headers.forEach((header, headerIndex) => {
      record[header] = values[headerIndex] ?? "";
    });
    return { rowNumber: index + 2, record, hasExtraValues: values.length > headers.length };
  });

  return records;
}

function parseMoney(value: string, required: boolean) {
  const cleaned = clean(value);
  if (!cleaned && !required) return { value: null, error: null };
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
    return { value: null, error: "must be a positive number using a decimal point, for example 125.00" };
  }
  const parsed = Number(cleaned);
  if ((!required && parsed < 0) || (required && parsed <= 0)) {
    return { value: null, error: required ? "must be greater than zero" : "cannot be negative" };
  }
  return { value: parsed, error: null };
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function candidateFromRow(row: CsvRow) {
  return {
    title: clean(row.candidate_title) || null,
    series: clean(row.candidate_series) || null,
    volume_number: clean(row.candidate_volume_number) || null,
    language: clean(row.candidate_language) || null,
    isbn_13: clean(row.candidate_isbn_13) || null,
    publisher: clean(row.candidate_publisher) || null,
    format: clean(row.candidate_format) || null,
  };
}

function reportFromRow(rowNumber: number, row: CsvRow, status: ReportRow["status"], issues: string[], match: EditionMatchAssessment | null = null): ReportRow {
  return {
    rowNumber,
    status,
    issues,
    source: clean(row.source_id),
    externalId: clean(row.external_id),
    listingTitle: clean(row.listing_title),
    soldDate: clean(row.sold_date),
    price: clean(row.sale_price),
    currency: clean(row.currency).toUpperCase(),
    evidenceImageUrl: clean(row.evidence_image_url),
    match,
  };
}

async function loadEdition(editionId: string) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("manga_editions")
    .select("id,title,series,volume_number,language,isbn_13,publisher,printing_number,edition_statement,variant_name")
    .eq("id", editionId)
    .eq("is_verified", true)
    .maybeSingle();

  if (error) throw new Error("The selected edition could not be checked.");
  return (data as Edition | null) ?? null;
}

async function loadCollectionRun(collectionRunId: string, editionId: string) {
  const admin = getSupabaseAdmin();
  const { data: run, error: runError } = await admin
    .from("marketplace_collection_runs")
    .select("id,profile_id")
    .eq("id", collectionRunId)
    .maybeSingle();
  if (runError || !run) return null;

  const typedRun = run as CollectionRun;
  const { data: profile, error: profileError } = await admin
    .from("marketplace_search_profiles")
    .select("id")
    .eq("id", typedRun.profile_id)
    .eq("edition_id", editionId)
    .eq("is_active", true)
    .maybeSingle();
  if (profileError || !profile) return null;
  return typedRun;
}

async function preflight(csv: string, edition: Edition) {
  const parsedRows = parseCsv(csv);
  const admin = getSupabaseAdmin();
  const { data: sourceRows, error: sourceError } = await admin.from("sources").select("id,name").eq("is_active", true);
  if (sourceError) throw new Error("RAR sources could not be loaded.");
  const sources = (sourceRows ?? []) as Source[];

  const reports: ReportRow[] = [];
  const prepared: PreparedSale[] = [];
  const externalIdsBySource = new Map<string, Set<string>>();
  const seenFileKeys = new Set<string>();

  for (const { rowNumber, record, hasExtraValues } of parsedRows) {
    const issues: string[] = [];
    const source = sourceForValue(clean(record.source_id), sources);
    const externalId = clean(record.external_id);
    const listingTitle = clean(record.listing_title);
    const listingUrl = clean(record.source_listing_url);
    const saleStatus = clean(record.sale_status).toLowerCase();
    const saleType = clean(record.sale_type).toLowerCase();
    const soldDate = clean(record.sold_date);
    const salePrice = parseMoney(record.sale_price, true);
    const shippingPrice = parseMoney(record.shipping_price, false);
    const currency = clean(record.currency).toUpperCase();
    const sealed = clean(record.is_sealed).toLowerCase();
    const evidenceImageUrl = clean(record.evidence_image_url);
    const candidate = candidateFromRow(record);
    const match = assessEditionMatch(edition, candidate);
    let rawPayload: Record<string, unknown> | null = null;

    if (hasExtraValues) issues.push("contains more values than the header row");
    if (!source) issues.push("source_id is not one active RAR marketplace source");
    if (!externalId) issues.push("external_id is required");
    if (!listingTitle) issues.push("listing_title is required");
    try {
      const url = new URL(listingUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") issues.push("source_listing_url must use http or https");
    } catch {
      issues.push("source_listing_url must be a valid http or https URL");
    }
    if (evidenceImageUrl) {
      try {
        const url = new URL(evidenceImageUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") issues.push("evidence_image_url must use http or https");
      } catch {
        issues.push("evidence_image_url must be a valid http or https URL when supplied");
      }
    }
    if (saleStatus !== "confirmed") issues.push("sale_status must be confirmed; ended or withdrawn listings cannot enter the queue");
    if (!["auction", "best_offer", "fixed_price", "unknown"].includes(saleType)) {
      issues.push("sale_type must be auction, best_offer, fixed_price, or unknown");
    }
    if (!isIsoDate(soldDate)) issues.push("sold_date must use YYYY-MM-DD");
    if (salePrice.error) issues.push(`sale_price ${salePrice.error}`);
    if (shippingPrice.error) issues.push(`shipping_price ${shippingPrice.error}`);
    if (!/^[A-Z]{3}$/.test(currency)) issues.push("currency must be a three-letter code such as GBP, USD, or JPY");
    if (!candidate.title) issues.push("candidate_title is required");
    if (!candidate.language) issues.push("candidate_language is required");
    if (match.conflicts.length) issues.push(...match.conflicts);
    if (sealed && !["true", "false", "yes", "no", "1", "0"].includes(sealed)) {
      issues.push("is_sealed must be true or false when supplied");
    }
    try {
      const parsed = JSON.parse(clean(record.raw_payload));
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
      rawPayload = parsed as Record<string, unknown>;
    } catch {
      issues.push("raw_payload must be a JSON object");
    }

    const sourceId = source?.id ?? "";
    const fileKey = sourceId && externalId ? `${sourceId}:${externalId}` : "";
    if (fileKey && seenFileKeys.has(fileKey)) issues.push("duplicates another row in this CSV batch");
    if (fileKey) seenFileKeys.add(fileKey);

    if (issues.length || !source || !rawPayload || salePrice.value === null) {
      reports.push(reportFromRow(rowNumber, record, "blocked", issues, match));
      continue;
    }

    if (!externalIdsBySource.has(source.id)) externalIdsBySource.set(source.id, new Set());
    externalIdsBySource.get(source.id)?.add(externalId);
    prepared.push({
      rowNumber,
      sourceId: source.id,
      externalId,
      sourceListingUrl: listingUrl,
      listingTitle,
      soldDate,
      salePrice: salePrice.value,
      saleType: saleType as PreparedSale["saleType"],
      currency,
      shippingPrice: shippingPrice.value,
      itemCondition: clean(record.item_condition) || null,
      isSealed: ["true", "yes", "1"].includes(sealed),
      evidenceImageUrl: evidenceImageUrl || null,
      rawPayload,
      candidate,
      match,
    });
  }

  const existingKeys = new Set<string>();
  for (const [sourceId, externalIds] of externalIdsBySource) {
    const ids = [...externalIds];
    if (!ids.length) continue;
    const { data, error } = await admin
      .from("price_observations")
      .select("source_id,external_id")
      .eq("source_id", sourceId)
      .in("external_id", ids);
    if (error) throw new Error("Existing marketplace listings could not be checked.");
    for (const record of data ?? []) {
      if (record.external_id) existingKeys.add(`${record.source_id}:${record.external_id}`);
    }
  }

  const ready: PreparedSale[] = [];
  for (const sale of prepared) {
    const sourceRow = parsedRows.find((item) => item.rowNumber === sale.rowNumber);
    if (!sourceRow) continue;
    if (existingKeys.has(`${sale.sourceId}:${sale.externalId}`)) {
      reports.push(reportFromRow(sale.rowNumber, sourceRow.record, "duplicate", ["already exists in RAR and will not be overwritten"], sale.match));
    } else {
      ready.push(sale);
      reports.push(reportFromRow(sale.rowNumber, sourceRow.record, "ready", [], sale.match));
    }
  }

  reports.sort((left, right) => left.rowNumber - right.rowNumber);
  return {
    edition,
    totalRows: parsedRows.length,
    readyCount: ready.length,
    duplicateCount: reports.filter((row) => row.status === "duplicate").length,
    blockedCount: reports.filter((row) => row.status === "blocked").length,
    rows: reports,
    ready,
  };
}

function publicPreflight(result: Awaited<ReturnType<typeof preflight>>) {
  return {
    edition: result.edition,
    totalRows: result.totalRows,
    readyCount: result.readyCount,
    duplicateCount: result.duplicateCount,
    blockedCount: result.blockedCount,
    rows: result.rows,
  };
}

export async function GET(request: NextRequest) {
  if (!isStaffRequest(request)) return Response.json({ error: "Staff credentials are required." }, { status: 401 });

  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (query.length < 2) return Response.json({ editions: [] });

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("manga_editions")
      .select("id,title,series,volume_number,language,isbn_13,printing_number,edition_statement,variant_name")
      .ilike("title", `%${query.replace(/[\\%_]/g, "\\$&")}%`)
      .eq("is_verified", true)
      .order("title")
      .limit(8);
    if (error) return Response.json({ error: "Edition suggestions could not be loaded." }, { status: 500 });
    return Response.json({ editions: data ?? [] });
  } catch {
    return Response.json({ error: "Edition suggestions are unavailable right now." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isStaffRequest(request)) return Response.json({ error: "Staff credentials are required." }, { status: 401 });

  let payload: { editionId?: unknown; collectionRunId?: unknown; csv?: unknown; dryRun?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send an edition, a CSV batch, and whether this is a preflight." }, { status: 400 });
  }

  const editionId = typeof payload.editionId === "string" ? payload.editionId.trim() : "";
  const collectionRunId = typeof payload.collectionRunId === "string" ? payload.collectionRunId.trim() : "";
  const csv = typeof payload.csv === "string" ? payload.csv : "";
  const dryRun = payload.dryRun !== false;
  if (!editionId) return Response.json({ error: "Select the exact RAR edition for this batch." }, { status: 400 });
  if (!collectionRunId) return Response.json({ error: "Choose the recorded collection run that found this batch." }, { status: 400 });
  if (!csv.trim()) return Response.json({ error: "Paste a CSV batch before running preflight." }, { status: 400 });
  if (csv.length > MAX_CSV_CHARACTERS) return Response.json({ error: "This CSV is too large. Split it into smaller batches of up to 500 rows." }, { status: 400 });

  try {
    const edition = await loadEdition(editionId);
    if (!edition) return Response.json({ error: "Select a verified RAR edition before importing sales." }, { status: 400 });
    const collectionRun = await loadCollectionRun(collectionRunId, edition.id);
    if (!collectionRun) return Response.json({ error: "Choose an active collection run for this exact edition." }, { status: 400 });

    const result = await preflight(csv, edition);
    if (dryRun || !result.ready.length) return Response.json({ ...publicPreflight(result), committed: 0 });

    const importedAt = new Date().toISOString();
    const records = result.ready.map((sale) => ({
      edition_id: edition.id,
      collection_run_id: collectionRun.id,
      source_id: sale.sourceId,
      source_listing_url: sale.sourceListingUrl,
      external_id: sale.externalId,
      listing_title: sale.listingTitle,
      sold_date: sale.soldDate,
      sale_price: sale.salePrice,
      currency: sale.currency,
      shipping_price: sale.shippingPrice,
      quantity: 1,
      sale_type: sale.saleType,
      item_condition: sale.itemCondition,
      is_sealed: sale.isSealed,
      raw_payload: {
        ...sale.rawPayload,
        rar_import_metadata: {
          contract_version: "marketplace-csv-v1",
          imported_at: importedAt,
          candidate: sale.candidate,
          evidence_image_url: sale.evidenceImageUrl,
          edition_match: sale.match,
        },
      },
      is_verified: false,
      match_status: "needs_review",
      sale_status: "confirmed",
      notes: `Imported through CSV preflight. ${sale.match.confidence} match signal (${sale.match.score}/100): ${sale.match.reasons.join(", ") || "listing evidence needs review"}. Awaiting exact-edition review.`,
    }));

    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("price_observations").insert(records).select("id");
    if (error?.code === "23505") {
      return Response.json({ error: "A listing was imported by another session. Run preflight again; RAR will not overwrite it." }, { status: 409 });
    }
    if (error) return Response.json({ error: "The safe sales could not be queued. Nothing was verified automatically." }, { status: 500 });

    return Response.json({ ...publicPreflight(result), committed: data?.length ?? 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The CSV could not be checked.";
    return Response.json({ error: message }, { status: 400 });
  }
}
