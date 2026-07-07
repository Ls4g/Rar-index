import { supabase } from "@/lib/supabase";

export default async function Home() {
  const { data: manga, error } = await supabase
  .from("manga")
  .select("*");

console.log({ manga, error });

  return (
    <main style={{ padding: "2rem" }}>
      <h1>RAR Index</h1>

      {error && <p>Error: {error.message}</p>}

      {manga?.map((item) => (
        <div key={item.id} style={{ marginBottom: "1rem" }}>
          <h2>{item.title}</h2>
          <p>{item.publisher}</p>
          <p>{item.isbn}</p>
        </div>
      ))}
    </main>
  );
}