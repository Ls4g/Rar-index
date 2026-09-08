import EditionRequestForm from "@/components/EditionRequestForm";
import PublicHeader from "@/components/PublicHeader";

export default function RequestEditionPage() {
  return <main className="public-page">
    <PublicHeader />
    <section className="tool-hero">
      <p className="eyebrow">Missing something?</p>
      <h1>Ask us to add a manga.</h1>
      <p>Spotted one we don&apos;t have? Send it over with the best source you can find. We research every request before it goes in the catalogue — nothing is added on someone&apos;s word alone.</p>
    </section>
    <section className="tool-content"><EditionRequestForm /></section>
  </main>;
}
