/** Read every page or fail. A failed read must never become an empty dataset. */
export async function readCompleteRows<T>(
  label: string,
  readPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await readPage(from, from + pageSize - 1);
    if (error) throw new Error(`Could not load ${label}: ${error.message}`);
    if (!Array.isArray(data)) throw new Error(`Could not load ${label}: no result returned.`);
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}
