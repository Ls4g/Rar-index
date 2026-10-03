// Read-only check: compare Open Library book-record covers with its direct
// ISBN cover endpoint for editions still awaiting a verified cover.
import { createClient } from "@supabase/supabase-js";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supply the local Supabase environment to run this read-only report.");
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await admin.from("cover_review_queue")
  .select("edition_id,title,isbn_13,collectible_type")
  .not("isbn_13", "is", null)
  .limit(200);
if (error) throw error;

const rows = data ?? [];
const results = [];
for (let index = 0; index < rows.length; index += 3) {
  const batch = rows.slice(index, index + 3);
  results.push(...await Promise.all(batch.map(async (row) => {
    const isbn = row.isbn_13;
    const key = `ISBN:${isbn}`;
    try {
      const [recordResponse, coverResponse] = await Promise.all([
        fetch(`https://openlibrary.org/api/books?bibkeys=${key}&format=json&jscmd=data`),
        fetch(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`, { method: "HEAD" }),
      ]);
      if (!recordResponse.ok) throw new Error(`book record HTTP ${recordResponse.status}`);
      const record = (await recordResponse.json())[key];
      return {
        title: row.title,
        isbn,
        hasBookRecord: Boolean(record),
        hasRecordCover: Boolean(record?.cover?.large || record?.cover?.medium || record?.cover?.small),
        directCoverStatus: coverResponse.status,
      };
    } catch (failure) {
      return { title: row.title, isbn, error: failure instanceof Error ? failure.message : "request failed" };
    }
  })));
}

console.log(JSON.stringify({
  editionsChecked: results.length,
  directCoversFound: results.filter((row) => row.directCoverStatus === 200).length,
  newCandidates: results.filter((row) => row.hasBookRecord && !row.hasRecordCover && row.directCoverStatus === 200),
  coversWithoutRecord: results.filter((row) => !row.hasBookRecord && row.directCoverStatus === 200),
  failures: results.filter((row) => row.error || (row.directCoverStatus !== 200 && row.directCoverStatus !== 404)),
}, null, 2));
