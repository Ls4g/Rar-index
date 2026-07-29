"use client";

import Link from "next/link";
import { useState } from "react";

type LanguagePath = "" | "japanese" | "english";

export default function IdentificationTool() {
  const [path, setPath] = useState<LanguagePath>("");
  const [copyrightPage, setCopyrightPage] = useState(false);
  const [titleMatches, setTitleMatches] = useState(false);
  const [japaneseMark, setJapaneseMark] = useState(false);
  const [numberLineOne, setNumberLineOne] = useState(false);
  const [englishFirstPrintLabel, setEnglishFirstPrintLabel] = useState(false);

  const basicEvidence = copyrightPage && titleMatches;
  const candidate = path === "japanese"
    ? basicEvidence && japaneseMark
    : path === "english"
      ? basicEvidence && numberLineOne && englishFirstPrintLabel
      : false;
  const missing = path === "japanese"
    ? [!copyrightPage && "a clear copyright-page photo", !titleMatches && "a title/ISBN match", !japaneseMark && "an explicit Japanese first-printing mark (for example 第1刷)"].filter(Boolean)
    : [!copyrightPage && "a clear copyright-page photo", !titleMatches && "a title/ISBN match", !numberLineOne && "a number line ending in 1", !englishFirstPrintLabel && "the publisher first-printing statement, where used"].filter(Boolean);

  function reset(nextPath: LanguagePath) {
    setPath(nextPath);
    setCopyrightPage(false);
    setTitleMatches(false);
    setJapaneseMark(false);
    setNumberLineOne(false);
    setEnglishFirstPrintLabel(false);
  }

  return (
    <div className="identify-tool">
      <section className="identify-step">
        <p className="eyebrow">Step 1</p>
        <h2>Which copy are you checking?</h2>
        <div className="identify-choice-grid">
          <button className={path === "japanese" ? "selected" : ""} onClick={() => reset("japanese")} type="button">
            <strong>Japanese publication</strong>
            <span>Check the colophon / copyright page for the printing line.</span>
          </button>
          <button className={path === "english" ? "selected" : ""} onClick={() => reset("english")} type="button">
            <strong>English publication</strong>
            <span>Check the copyright page and the publisher printing indicators.</span>
          </button>
        </div>
      </section>

      {path ? (
        <section className="identify-step">
          <p className="eyebrow">Step 2</p>
          <h2>Check the evidence in the book</h2>
          <div className="identify-checks">
            <label><input checked={copyrightPage} onChange={(event) => setCopyrightPage(event.target.checked)} type="checkbox" />I can see a clear copyright-page image from this actual copy.</label>
            <label><input checked={titleMatches} onChange={(event) => setTitleMatches(event.target.checked)} type="checkbox" />The title and ISBN/publisher information match the copy I am checking.</label>
            {path === "japanese" ? (
              <label><input checked={japaneseMark} onChange={(event) => setJapaneseMark(event.target.checked)} type="checkbox" />The printing line explicitly shows a first printing, such as 第1刷.</label>
            ) : (
              <>
                <label><input checked={numberLineOne} onChange={(event) => setNumberLineOne(event.target.checked)} type="checkbox" />The publisher number line ends in 1.</label>
                <label><input checked={englishFirstPrintLabel} onChange={(event) => setEnglishFirstPrintLabel(event.target.checked)} type="checkbox" />The copyright page also states &quot;First Printing&quot;, where this publisher uses that wording.</label>
              </>
            )}
          </div>
        </section>
      ) : null}

      {path ? (
        <section className={`identify-result ${candidate ? "candidate" : "needs-evidence"}`}>
          <p className="eyebrow">RAR result</p>
          {candidate ? (
            <><h2>Strong first-print indicators.</h2><p>This copy appears to match the physical indicators RAR expects. It is not an RAR-verified record until the source image is reviewed against the exact edition.</p></>
          ) : (
            <><h2>Not enough evidence to call it.</h2><p>{missing.length ? `You still need ${missing.join(", ")}.` : "Check the publisher-specific details before making a first-print claim."}</p></>
          )}
          <div className="identify-result-actions">
            <Link href="/request-edition">Ask RAR to research this copy -&gt;</Link>
            <Link href="/browse">Search existing editions -&gt;</Link>
          </div>
        </section>
      ) : null}

      <p className="identify-disclaimer">RAR does not infer printing from a release date, a seller title, or a cover alone. Publisher practices vary, especially across English-language releases.</p>
    </div>
  );
}
