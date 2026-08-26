// AniList: which manga RAR should be looking at. Nothing else.
//
// THE BOUNDARY, because it is the whole reason this file is separate.
// AniList is a community anime/manga database. It knows what is popular, what
// is trending, what started recently, and what a series is called. It does not
// know ISBNs, publishers, printings, bindings or covers, and its volume counts
// are a community-maintained summary of a work rather than a bibliographic
// record of any physical book.
//
// So nothing returned here may ever become an edition. A signal from AniList
// decides what RAR *searches for*; a physical edition still has to be proved
// by Shueisha or a library record, exactly as before.
//
// One measured consequence worth stating up front: AniList reports
// `volumes: null` for every RELEASING series. Kagurabachi, Hunter x Hunter and
// One Piece all come back null. That means it can never be used to claim a
// next volume exists -- which is correct, and is why gap targets are
// *scheduled for research* rather than asserted.

const ENDPOINT = "https://graphql.anilist.co";

export type AniListWork = {
  externalId: string;
  titleEnglish: string | null;
  titleRomaji: string | null;
  titleNative: string | null;
  popularity: number | null;
  trending: number | null;
  status: string | null;
  startYear: number | null;
  startMonth: number | null;
  // Null for every ongoing series. Only ever used where AniList actually
  // reports it, and even then only as a hint about where a series ends.
  reportedVolumes: number | null;
  format: string | null;
  siteUrl: string | null;
};

type MediaNode = {
  id?: number;
  title?: { english?: string | null; romaji?: string | null; native?: string | null };
  popularity?: number | null;
  trending?: number | null;
  status?: string | null;
  startDate?: { year?: number | null; month?: number | null };
  volumes?: number | null;
  format?: string | null;
  siteUrl?: string | null;
};

const MEDIA_FIELDS = `
  id
  title { english romaji native }
  popularity
  trending
  status
  startDate { year month }
  volumes
  format
  siteUrl
`;

async function query(document: string, variables: Record<string, unknown>): Promise<MediaNode[]> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: document, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`AniList returned HTTP ${response.status}`);
  const payload = await response.json() as { data?: { Page?: { media?: MediaNode[] } }; errors?: Array<{ message?: string }> };
  if (payload.errors?.length) throw new Error(`AniList: ${payload.errors[0]?.message ?? "query rejected"}`);
  return payload.data?.Page?.media ?? [];
}

function toWork(node: MediaNode): AniListWork | null {
  if (!node.id) return null;
  const titleEnglish = node.title?.english?.trim() || null;
  const titleRomaji = node.title?.romaji?.trim() || null;
  if (!titleEnglish && !titleRomaji) return null;
  return {
    externalId: String(node.id),
    titleEnglish,
    titleRomaji,
    titleNative: node.title?.native?.trim() || null,
    popularity: typeof node.popularity === "number" ? node.popularity : null,
    trending: typeof node.trending === "number" ? node.trending : null,
    status: node.status ?? null,
    startYear: node.startDate?.year ?? null,
    startMonth: node.startDate?.month ?? null,
    reportedVolumes: typeof node.volumes === "number" && node.volumes > 0 ? node.volumes : null,
    format: node.format ?? null,
    siteUrl: node.siteUrl ?? null,
  };
}

// AniList asks for 90 requests a minute; RAR uses a handful per day, but the
// pause keeps a multi-page sweep well inside it without needing a limiter.
async function pause() {
  await new Promise((resolve) => setTimeout(resolve, 700));
}

// MANGA excludes light novels and one-shots; countryOfOrigin JP excludes
// manhwa and manhua, which RAR does not catalogue.
const BASE_FILTER = `type: MANGA, countryOfOrigin: "JP", format_in: [MANGA, ONE_SHOT]`;

export async function fetchEstablishedManga(pages = 2, perPage = 50): Promise<AniListWork[]> {
  const document = `query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) { media(${BASE_FILTER}, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} } }
  }`;
  const works: AniListWork[] = [];
  for (let page = 1; page <= pages; page += 1) {
    const nodes = await query(document, { page, perPage });
    works.push(...nodes.map(toWork).filter((work): work is AniListWork => work !== null));
    if (page < pages) await pause();
  }
  return works;
}

export async function fetchRisingManga(perPage = 40): Promise<AniListWork[]> {
  const document = `query ($perPage: Int) {
    Page(page: 1, perPage: $perPage) { media(${BASE_FILTER}, sort: TRENDING_DESC) { ${MEDIA_FIELDS} } }
  }`;
  const nodes = await query(document, { perPage });
  // A trending score of zero is not trending; it is just a row the sort had
  // to return once the genuinely trending ones ran out.
  return nodes.map(toWork).filter((work): work is AniListWork => work !== null && (work.trending ?? 0) > 0);
}

export async function fetchNewManga(sinceYear: number, perPage = 40): Promise<AniListWork[]> {
  const document = `query ($since: FuzzyDateInt, $perPage: Int) {
    Page(page: 1, perPage: $perPage) { media(${BASE_FILTER}, startDate_greater: $since, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} } }
  }`;
  const nodes = await query(document, { since: sinceYear * 10_000 + 101, perPage });
  return nodes
    .map(toWork)
    .filter((work): work is AniListWork => work !== null)
    // The API's startDate_greater is fuzzy enough to return older series, so
    // the year is checked again here rather than trusted.
    .filter((work) => (work.startYear ?? 0) >= sinceYear);
}

// Used by the gap lane to learn how long a series runs, and by the UI to show
// what RAR believes about a series it already holds.
export async function lookupMangaByTitle(title: string): Promise<AniListWork | null> {
  const document = `query ($search: String) {
    Page(page: 1, perPage: 1) { media(${BASE_FILTER}, search: $search) { ${MEDIA_FIELDS} } }
  }`;
  const nodes = await query(document, { search: title });
  return nodes.map(toWork).find((work): work is AniListWork => work !== null) ?? null;
}
