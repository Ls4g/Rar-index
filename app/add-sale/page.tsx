import Link from "next/link";
import QuickSaleForm from "@/components/QuickSaleForm";
import StaffNav from "@/components/StaffNav";

type AddSalePageProps = { searchParams: Promise<{ editionId?: string | string[] }> };

export default async function AddSalePage({ searchParams }: AddSalePageProps) {
  const parameters = await searchParams;
  const initialEditionId = typeof parameters.editionId === "string" ? parameters.editionId : "";
  return <main className="review-page catalogue-page">
    <header className="site-header"><Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link><Link className="header-note" href="/review">Review queue -&gt;</Link><Link className="header-note" href="/price-import">CSV batch import -&gt;</Link><StaffNav current="/add-sale" /></header>
    <section className="review-hero catalogue-hero"><div><p className="eyebrow">Staff sales intake</p><h1>Add one completed sale</h1><p>For a confirmed marketplace sale you have checked yourself. It enters the review queue first, so it cannot change a public price until its edition match is verified.</p></div></section>
    <section className="catalogue-content"><div className="section-intro"><p className="eyebrow">The simple route</p><h2>Capture the evidence, then decide</h2><p className="section-copy">Use this for one sale at a time. You do not need a Scout scan; the exact RAR edition and original completed-sale link are what keep a convenient form from quietly polluting the index.</p></div><QuickSaleForm initialEditionId={initialEditionId} /><section className="catalogue-rules" aria-label="Quick sale safeguards"><div><span>1</span><strong>Exact record</strong><p>Choose the published RAR edition, not a similar title.</p></div><div><span>2</span><strong>Original source</strong><p>Save the source link and marketplace ID so anyone can inspect it.</p></div><div><span>3</span><strong>Human review</strong><p>The queue decides whether it becomes market evidence.</p></div></section></section>
  </main>;
}
