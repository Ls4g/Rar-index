"use client";

import { useState } from "react";
import { outcomeIsBestOffer, type OutcomeSaleConfirmation } from "@/lib/outcomeSaleConfirmation";

export default function OutcomeSaleConfirmationForm({ listingTitle, buyingFormat, outcomeProvider, disabled, saving, onConfirm }: {
  listingTitle: string; buyingFormat: string | null; outcomeProvider: string | null;
  disabled: boolean; saving: boolean; onConfirm: (confirmation: OutcomeSaleConfirmation) => void;
}) {
  const [grading, setGrading] = useState("");
  const [gradingCompany, setGradingCompany] = useState("");
  const [gradeLabel, setGradeLabel] = useState("");
  const bestOffer = outcomeIsBestOffer(buyingFormat, listingTitle);
  return <form className="best-offer-corroboration outcome-sale-confirmation" onSubmit={(event) => {
    event.preventDefault();
    onConfirm({ humanConfirmed: true, grading, gradingCompany, gradeLabel });
  }}>
    <div className="best-offer-fields">
      <label>Copy type<select required value={grading} onChange={(event) => setGrading(event.target.value)}><option value="">Choose after inspecting</option><option value="raw">Raw / ungraded</option><option value="graded">Graded</option></select></label>
      {grading === "graded" ? <>
        <label>Grading company<input required value={gradingCompany} onChange={(event) => setGradingCompany(event.target.value)} placeholder="e.g. CGC" /></label>
        <label>Exact grade<input required value={gradeLabel} onChange={(event) => setGradeLabel(event.target.value)} placeholder="e.g. 9.8" /></label>
      </> : null}
    </div>
    {bestOffer ? <p>{outcomeProvider === "130point manual corroboration" ? "This older candidate keeps its existing 130point audit evidence." : "The original eBay sold page is reused as the accepted-price evidence. No second proof link is needed."}</p> : null}
    <p>By verifying, I confirm I opened the working original source and checked the completed sale, exact edition (including any printing claim), copy type and paid item price for one copy, excluding delivery. Lots need individual evidence; printing proof can be recorded in Add sale.</p>
    <button className="catalogue-bulk-approve" disabled={disabled || !grading || (grading === "graded" && (!gradingCompany.trim() || !gradeLabel.trim()))} type="submit">{saving ? "Verifying…" : "Confirm details and verify sale"}</button>
  </form>;
}
