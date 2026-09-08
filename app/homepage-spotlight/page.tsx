import Link from "next/link";
import HomepageSpotlightForm, { type SpotlightEditionOption } from "@/components/HomepageSpotlightForm";
import StaffNav from "@/components/StaffNav";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Selection = { id: string; edition_id: string; accent_color: string; selection_method: string; selection_note: string | null; selected_by: string; selected_at: string };

export default async function HomepageSpotlightPage() {
  const admin = getSupabaseAdmin();
  const [{ data: editionData }, { data: selectionData }] = await Promise.all([
    admin.from("manga_editions")
      .select("id,title,series,volume_number,language,publisher,isbn_13,cover_image_url")
      .eq("record_kind", "publication")
      .eq("is_verified", true)
      .eq("cover_verification_status", "verified")
      .not("cover_image_url", "is", null)
      .order("series", { ascending: true })
      .order("volume_number", { ascending: true })
      .limit(500),
    admin.from("homepage_feature_selections")
      .select("id,edition_id,accent_color,selection_method,selection_note,selected_by,selected_at")
      .eq("slot", "edition_of_week")
      .order("selected_at", { ascending: false })
      .limit(12),
  ]);
  const editions = (editionData ?? []) as SpotlightEditionOption[];
  const selections = (selectionData ?? []) as Selection[];
  const current = selections[0] ?? null;
  const editionById = new Map(editions.map((edition) => [edition.id, edition]));

  return (
    <main className="review-page catalogue-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/">View homepage -&gt;</Link>
        <StaffNav current="/homepage-spotlight" />
      </header>
      <section className="review-hero catalogue-hero">
        <div><p className="eyebrow">Homepage curation</p><h1>Edition of the Week</h1><p>Choose the verified publication that leads the public homepage. Every change is kept as history; a future rating system can use the same slot without overwriting staff choices.</p></div>
        <div className="queue-total"><strong>{editions.length}</strong><span>eligible editions</span></div>
      </section>
      <section className="catalogue-content">
        <section className="review-list-section workbench-section">
          <div className="section-intro"><p className="eyebrow">Current selection</p><h2>{current ? editionById.get(current.edition_id)?.title ?? "Selected publication" : "No edition selected"}</h2></div>
          <HomepageSpotlightForm editions={editions} currentEditionId={current?.edition_id ?? null} currentAccent={current?.accent_color ?? "#e31b23"} />
        </section>
        {selections.length ? <section className="review-list-section workbench-section"><div className="section-intro"><p className="eyebrow">Selection history</p><h2>Previous staff choices</h2></div><div className="review-list">{selections.map((selection) => { const edition = editionById.get(selection.edition_id); return <article className="review-card" key={selection.id}><div className="review-card-topline"><span>{selection.selection_method}</span><time>{new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(selection.selected_at))}</time></div><div className="review-card-main"><div><h3>{edition?.title ?? selection.edition_id}</h3><p className="review-condition">{[edition?.series, edition?.volume_number ? `Vol. ${edition.volume_number}` : null, edition?.language, edition?.publisher].filter(Boolean).join(" · ")}</p></div><span style={{ background: selection.accent_color, borderRadius: "999px", display: "block", height: "2rem", width: "2rem" }} aria-label={`Accent ${selection.accent_color}`} /></div><div className="review-note"><span>{selection.selected_by}</span><p>{selection.selection_note ?? "No selection note."}</p></div></article>; })}</div></section> : null}
      </section>
    </main>
  );
}
