export const CATALOGUE_PAGE_SIZE = 50;

export async function catalogueWindow<T extends { id: string }>(
  requestedPage: string | undefined,
  focusedId: string | undefined,
  readPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; count: number | null; error: { message: string } | null }>,
  readFocused: (id: string) => PromiseLike<{ data: T | null; error: { message: string } | null }>,
) {
  const parsed = Number(requestedPage);
  let page = Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 1_000_000) : 1;
  const read = async () => {
    const result = await readPage((page - 1) * CATALOGUE_PAGE_SIZE, page * CATALOGUE_PAGE_SIZE - 1);
    if (result.error || !result.data || result.count === null) throw new Error("The catalogue queue could not be loaded. Retry; no candidates were changed.");
    return { data: result.data, count: result.count };
  };
  let result = await read();
  const pages = Math.max(1, Math.ceil(result.count / CATALOGUE_PAGE_SIZE));
  if (page > pages) { page = pages; result = await read(); }
  const records = [...result.data];
  let focusedMissing = false;
  let focusedAdded = false;
  if (focusedId && !records.some((row) => row.id === focusedId)) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(focusedId)) {
      focusedMissing = true;
    } else {
      const focused = await readFocused(focusedId);
      if (focused.error) throw new Error("The linked catalogue candidate could not be loaded. Retry the link.");
      if (focused.data) { records.unshift(focused.data); focusedAdded = true; }
      else focusedMissing = true;
    }
  }
  return { records, total: result.count, page, pages, pageRows: result.data.length, focusedMissing, focusedAdded };
}
