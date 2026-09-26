"use client";

export default function CatalogueError({ reset }: { reset: () => void }) {
  return <main className="review-page catalogue-page"><section className="review-hero">
    <div role="alert"><h1>Catalogue review is temporarily unavailable</h1>
      <p>RAR could not load the queue or its edition checks. This does not mean the queue is empty. No candidates were changed.</p>
      <button type="button" onClick={reset}>Try again</button></div>
  </section></main>;
}
