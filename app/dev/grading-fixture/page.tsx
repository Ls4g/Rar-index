import { notFound } from "next/navigation";
import HumanDecisionInbox from "@/components/HumanDecisionInbox";

// A grading conflict that does not exist, so the card can be seen.
//
// The grading card only appears when a verified sale's grading contradicts
// itself, and there is exactly one such sale in production at a time -- which
// a person has now resolved. That left the card unverifiable: the only honest
// ways to see it were to fabricate a conflict on real evidence, which the
// project forbids, or to render it against a fixture. This is the fixture.
//
// The observation id belongs to nothing. Saving from here reaches the real
// /api/observation-grading route, which reaches the real RPC, which cannot
// find the row -- so the error path is exercised end to end and no production
// evidence can be touched. Never point this at a real observation id.
//
// Returns 404 outside development.

export const dynamic = "force-dynamic";

const FIXTURE_OBSERVATION_ID = "00000000-0000-4000-8000-00000000dead";

export default async function GradingFixturePage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="review-page">
      <section className="catalogue-content">
        <div className="section-intro">
          <p className="eyebrow">Development fixture</p>
          <h1>Grading card</h1>
          <p className="section-copy">
            Not a real decision. This sale does not exist, so saving returns the
            API&apos;s error path rather than writing anything. Use it to check the
            card&apos;s fields, its required source confirmation and its validation.
          </p>
        </div>
        <HumanDecisionInbox
          catalogue={[]}
          catalogueRequests={[]}
          communityReports={[]}
          covers={[]}
          gradingConflicts={[{
            observationId: FIXTURE_OBSERVATION_ID,
            listingTitle: "FIXTURE — Hunter x Hunter Vol. 1 BGS 8.5 graded slab (not a real sale)",
            sourceUrl: "https://example.invalid/fixture-listing",
            soldDate: "2026-01-01",
            price: 120,
            currency: "USD",
            gradingCompany: null,
            gradeLabel: null,
            editionLabel: "Hunter x Hunter · Vol. 1 · English",
          }]}
          outcomes={[]}
          printing={[]}
          proposals={[]}
          sales={[]}
        />
      </section>
    </main>
  );
}
