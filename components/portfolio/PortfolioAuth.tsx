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
  busy: boolean;
  recoveryMode: boolean;
  newPassword: string;
  setNewPassword: (value: string) => void;
  onRequestRecovery: () => void;
  onUpdatePassword: (event: FormEvent<HTMLFormElement>) => void;
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

export default function PortfolioAuth({
  mode, setMode, email, setEmail, password, setPassword, authMessage, onSubmit, initialEditionId,
  busy, recoveryMode, newPassword, setNewPassword, onRequestRecovery, onUpdatePassword,
}: PortfolioAuthProps) {
  if (recoveryMode) {
    return (
      <section className="portfolio-auth">
        <div className="portfolio-auth-intro">
          <p className="eyebrow">Account recovery</p>
          <h1>Choose a new password</h1>
          <p className="portfolio-auth-lede">This form only changes the password for the account linked by the recovery email. Your private holdings are not changed.</p>
        </div>
        <form className="portfolio-auth-form" onSubmit={onUpdatePassword}>
          <label>New password<input autoComplete="new-password" minLength={6} onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} /></label>
          <button disabled={busy} type="submit">{busy ? "Updating…" : "Update password"}</button>
          {authMessage ? <p aria-live="polite" role="status">{authMessage}</p> : null}
        </form>
      </section>
    );
  }

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
        <button disabled={busy} type="submit">{busy ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create free account"}</button>
        {mode === "sign-in" ? (
          <button className="portfolio-text-button" disabled={busy} onClick={onRequestRecovery} type="button">Forgot password?</button>
        ) : null}
        {authMessage ? <p aria-live="polite" role="status">{authMessage}</p> : null}
        <p className="portfolio-auth-note">{mode === "sign-up" ? "Create a free account to keep your holdings private and available across devices." : "No holding data is ever shown before you sign in."}</p>
      </form>
    </section>
  );
}
