"use client";

import { FormEvent } from "react";

type Mode = "sign-up" | "sign-in";

type PortfolioAuthProps = {
  mode: Mode;
  setMode: (mode: Mode) => void;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  authMessage: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  initialEditionId: string;
};

// Feature preview only — never a numeric mockup. A fabricated "£1,240" or a
// fake gain percentage here would be exactly the kind of invented figure
// AGENTS.md forbids everywhere else on the site; the real dashboard earns
// its numbers from verified evidence after sign-in.
const PREVIEW_TILES = [
  { icon: "◒", title: "What it's all worth", copy: "What you paid and what copies are actually selling for, side by side." },
  { icon: "↕", title: "Up or down, honestly", copy: "A gain is only shown when there are real sales to compare against." },
  { icon: "◈", title: "First print or not", copy: "Every book says whether its printing is proven or still unknown." },
  { icon: "◐", title: "Only you see it", copy: "Your books and what you paid for them stay private." },
];

export default function PortfolioAuth({ mode, setMode, email, setEmail, password, setPassword, authMessage, onSubmit, initialEditionId }: PortfolioAuthProps) {
  return (
    <section className="portfolio-auth">
      <div className="portfolio-auth-intro">
        <p className="eyebrow">RAR Portfolio</p>
        <h1>What&apos;s your collection worth?</h1>
        <p className="portfolio-auth-lede">Add the manga you own and see what real copies are selling for. Free, private, and priced from actual completed sales — never guesswork.</p>
        {initialEditionId ? (
          <p className="portfolio-add-context">You&apos;re adding a specific manga. Create an account or sign in and it will be waiting for you.</p>
        ) : null}
        <div className="portfolio-preview-grid" aria-hidden="true">
          {PREVIEW_TILES.map((tile) => (
            <div className="portfolio-preview-tile" key={tile.title}>
              <span className="portfolio-preview-icon">{tile.icon}</span>
              <strong>{tile.title}</strong>
              <p>{tile.copy}</p>
            </div>
          ))}
        </div>
      </div>
      <form className="portfolio-auth-form" onSubmit={onSubmit}>
        <div className="portfolio-auth-options" aria-label="Portfolio access">
          <button className={mode === "sign-up" ? "selected" : ""} type="button" onClick={() => setMode("sign-up")}>Create free account</button>
          <button className={mode === "sign-in" ? "selected" : ""} type="button" onClick={() => setMode("sign-in")}>Sign in</button>
        </div>
        <p className="eyebrow">{mode === "sign-in" ? "Welcome back" : "Start your private portfolio"}</p>
        <label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
        <label>Password<input type="password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} /></label>
        <button type="submit">{mode === "sign-in" ? "Sign in" : "Create free account"}</button>
        {authMessage ? <p role="status">{authMessage}</p> : null}
        <p className="portfolio-auth-note">{mode === "sign-up" ? "Create a free account to keep your holdings private and available across devices." : "No holding data is ever shown before you sign in."}</p>
      </form>
    </section>
  );
}
