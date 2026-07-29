type Candidate = {
  title: string;
  language: string | null;
  isbn13: string | null;
  publisher: string | null;
  releaseDate: string | null;
};

function fact(value: string | null, present: string, missing: string) {
  return { state: value ? "recorded" : "needed", value: value ? present : missing };
}

export default function EditionIdentityChecklist({ candidate, isEditionCandidate }: { candidate: Candidate; isEditionCandidate: boolean }) {
  const facts = [
    { label: "Physical edition", ...fact(isEditionCandidate ? "yes" : null, "Edition-level source", "Series reference only") },
    { label: "Language", ...fact(candidate.language, candidate.language ?? "", "Confirm from source") },
    { label: "ISBN", ...fact(candidate.isbn13, candidate.isbn13 ?? "", "Confirm if assigned") },
    { label: "Publisher", ...fact(candidate.publisher, candidate.publisher ?? "", "Confirm from source") },
    { label: "Release date", ...fact(candidate.releaseDate, candidate.releaseDate ?? "", "Confirm from source") },
  ];

  return (
    <section className="identity-checklist" aria-label="Edition identification checklist">
      <p className="eyebrow">Edition identity check</p>
      <div className="identity-checklist-grid">
        {facts.map((item) => <div key={item.label}><span>{item.label}</span><strong className={item.state}>{item.value}</strong></div>)}
        <div><span>Specific printing</span><strong className="rule">Only claim with copyright-page proof</strong></div>
      </div>
      <p>Standard records identify the publication. A first print, later print, or variant is a separate record only when the source itself proves it.</p>
    </section>
  );
}
