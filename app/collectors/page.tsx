import Link from "next/link";
import type { Metadata } from "next";
import EditionCover from "@/components/EditionCover";
import PublicHeader from "@/components/PublicHeader";
import { supabase } from "@/lib/supabase";
import { readCompleteRows } from "@/lib/readCompleteRows";
import "./social.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Collector galleries — RAR Index",
  description: "Explore manga collections that RAR members have chosen to share.",
};

type Profile = { user_id: string; username: string };
type Cover = { id: string; title: string | null; series: string | null; volume_number: string | null; cover_image_url: string | null; cover_verification_status: string | null };

export default async function CollectorsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const search = (q ?? "").trim().replace(/[^a-zA-Z0-9_]/g, "").slice(0, 20);
  let query = supabase.from("collector_profiles").select("user_id,username")
    .eq("shelf_is_public", true).eq("directory_visible", true).order("updated_at", { ascending: false }).limit(24);
  if (search) query = query.ilike("username", `%${search}%`);
  const { data, error } = await query;
  const profiles = (data ?? []) as Profile[];
  let loadError = Boolean(error);
  let galleries: Array<{ profile: Profile; count: number; covers: Cover[] }> = [];
  try {
    const keys = profiles.map((p) => p.username.toLowerCase());
    const shelfRows = keys.length ? await readCompleteRows<{ username_key: string; edition_id: string }>("collector shelves", (from, to) => supabase.from("public_shelf_editions")
      .select("username_key,edition_id").in("username_key", keys).order("username_key").order("edition_id").range(from, to)) : [];
    const idsByHandle = new Map<string, string[]>();
    for (const row of shelfRows) {
      const ids = idsByHandle.get(row.username_key) ?? [];
      if (!ids.includes(row.edition_id)) ids.push(row.edition_id);
      idsByHandle.set(row.username_key, ids);
    }
    const candidateIds = [...new Set([...idsByHandle.values()].flatMap((ids) => ids.slice(0, 12)))];
    const editionChunks = await Promise.all(Array.from({ length: Math.ceil(candidateIds.length / 100) }, (_, index) =>
      supabase.from("manga_editions").select("id,title,series,volume_number,cover_image_url,cover_verification_status")
        .in("id", candidateIds.slice(index * 100, index * 100 + 100))));
    if (editionChunks.some((chunk) => chunk.error)) throw new Error("Cover lookup failed");
    const covers = new Map(editionChunks.flatMap((chunk) => (chunk.data ?? []) as Cover[]).map((edition) => [edition.id, edition]));
    galleries = profiles.map((profile) => {
      const editionIds = idsByHandle.get(profile.username.toLowerCase()) ?? [];
      return { profile, count: editionIds.length, covers: editionIds.map((id) => covers.get(id)).filter((edition): edition is Cover => Boolean(edition?.cover_image_url && edition.cover_verification_status === "verified")).slice(0, 3) };
    }).filter((gallery) => gallery.count > 0);
  } catch { loadError = true; }

  return <main className="public-page collector-directory"><PublicHeader />
    <section className="collector-directory-inner">
      <p className="eyebrow">Collector galleries</p>
      <h1>See what collectors are showing.</h1>
      <p>Real shelves, arranged by their owners. Browse the books they chose to share, then open a gallery to explore them.</p>
      <form action="/collectors" method="get" className="collector-directory-search">
        <label htmlFor="collector-search">Find a collector</label>
        <div><input id="collector-search" name="q" type="search" maxLength={20} defaultValue={search} placeholder="Search by @handle" /><button type="submit">Search</button></div>
      </form>
      {loadError ? <p role="alert">Galleries could not load. Please try again.</p> : galleries.length ? <div className="collector-directory-grid">
        {galleries.map(({ profile, count, covers: galleryCovers }) => <Link className="collector-directory-card" href={`/collectors/${profile.username}`} key={profile.user_id}>
          <div className="collector-directory-books">{galleryCovers.length ? galleryCovers.map((cover) => <EditionCover key={cover.id} title={cover.title} series={cover.series} volumeNumber={cover.volume_number} imageUrl={cover.cover_image_url} imageStatus={cover.cover_verification_status} />) : <span>No confirmed covers yet</span>}</div>
          <div className="collector-directory-card-info"><span>@{profile.username}</span><strong>{count} shared {count === 1 ? "edition" : "editions"}</strong><span aria-hidden="true">↗</span></div>
        </Link>)}
      </div> : <p className="collector-directory-empty">{search ? "No public galleries matched that handle." : "No collectors have opted into discovery yet. Your gallery can be the first."}</p>}
      <Link className="collector-directory-own" href="/portfolio">Arrange and share your own shelf ↗</Link>
    </section>
  </main>;
}
