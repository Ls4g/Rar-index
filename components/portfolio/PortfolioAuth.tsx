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
  { icon: "◒", title: "Collection value", copy: "Total paid and RAR's evidence-backed market value, side by side." },
  { icon: "↕", title: "Gain & loss, honestly", copy: "Only calculated when there is real verified evidence to compare against." },
  { icon: "◈", title: "Print status, made clear", copy: "Every holding shows whether it is a proven first print or printing not identified." },
  { icon: "◐", title: "Private by default", copy: "Your holdings and purchase details are visible only to you." },
];

export default function PortfolioAuth({ mode, setMode, email, setEmail, password, setPassword, authMessage, onSubmit, initialEditionId }: PortfolioAuthProps) {
  return (
    <section className="portfolio-auth">
      <div className="portfolio-auth-intro">
        <p className="eyebrow">RAR Portfolio</p>
        <h1>Know what you own.</h1>
        <p className="portfolio-auth-lede">Private holdings, linked to RAR&apos;s edition records and the verified market evidence behind them.</p>
        {initialEditionId ? (
          <p className="portfolio-add-context">You&apos;re adding a specific RAR edition. Create an account or sign in, then it will be ready to add.</p>
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
