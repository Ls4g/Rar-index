import Link from "next/link";
import CollectionProfileCreateForm from "@/components/CollectionProfileCreateForm";

type NewCollectionProfilePageProps = { searchParams: Promise<{ editionId?: string | string[] }> };

export default async function NewCollectionProfilePage({ searchParams }: NewCollectionProfilePageProps) {
  const parameters = await searchParams;
  const initialEditionId = typeof parameters.editionId === "string" ? parameters.editionId : "";
  return <main className="review-page catalogue-page">
    <header className="site-header"><Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link><Link className="header-note" href="/data-readiness">Back to readiness -&gt;</Link></header>
    <section className="review-hero catalogue-hero"><div><p className="eyebrow">Staff collection setup</p><h1>Create a marketplace profile</h1><p>Give one exact RAR edition one carefully bounded marketplace search. This starts data collection; it does not add or verify any sale.</p></div></section>
    <section className="catalogue-content"><div className="section-intro"><p className="eyebrow">Before collecting</p><h2>Make the search reproducible</h2><p className="section-copy">A profile records where RAR should look, what belongs to the edition, and when to look again. Keep the query narrow enough that another reviewer can repeat it.</p></div><CollectionProfileCreateForm initialEditionId={initialEditionId} /></section>
  </main>;
}
