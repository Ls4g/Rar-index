"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Edition = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  isbn_13: string | null;
  edition_statement: string | null;
  printing_number: number | null;
  variant_name: string | null;
};

type Holding = {
  id: string;
  edition_id: string;
  quantity: number;
  purchase_price: number | null;
  purchase_currency: string | null;
  purchase_date: string | null;
  notes: string | null;
  edition: Edition | null;
};

type Metric = { edition_id: string; currency: string; market_value_median: number; verified_sale_count: number; latest_sale_date: string | null };

function editionLabel(edition: Edition) {
  return [edition.title, edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language, edition.printing_number ? `Printing ${edition.printing_number}` : edition.edition_statement, edition.variant_name, edition.isbn_13 ? `ISBN ${edition.isbn_13}` : null].filter(Boolean).join(" | ");
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(value);
}

function totalsByCurrency(items: Array<{ value: number; currency: string }>) {
  return items.reduce<Map<string, number>>((totals, item) => {
    totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.value);
    return totals;
  }, new Map());
}

function MoneySummary({ totals, empty }: { totals: Map<string, number>; empty: string }) {
  if (!totals.size) return <strong className="portfolio-empty-total">{empty}</strong>;
  return <strong className="portfolio-total-values">{[...totals.entries()].map(([currency, value]) => <span key={currency}>{formatMoney(value, currency)}</span>)}</strong>;
}

export default function PortfolioClient({ initialEditionId = "" }: { initialEditionId?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-up");
  const [authMessage, setAuthMessage] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Edition[]>([]);
  const [selectedEdition, setSelectedEdition] = useState<Edition | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [purchaseCurrency, setPurchaseCurrency] = useState("GBP");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const visibleSuggestions = userEmail && query.trim().length >= 2 && !selectedEdition ? suggestions : [];

  async function loadPortfolio() {
    setLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    setUserEmail(user?.email ?? null);
    if (!user) {
      setHoldings([]);
      setMetrics([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("portfolio_holdings")
      .select("id,edition_id,quantity,purchase_price,purchase_currency,purchase_date,notes,edition:manga_editions(id,title,series,volume_number,language,isbn_13,edition_statement,printing_number,variant_name)")
      .order("created_at", { ascending: false });
    if (error) {
      setMessage("Your holdings could not be loaded. Please try again.");
      setLoading(false);
      return;
    }
    const nextHoldings = (data ?? []) as unknown as Holding[];
    setHoldings(nextHoldings);
    const ids = nextHoldings.map((holding) => holding.edition_id);
    if (!ids.length) {
      setMetrics([]);
      setLoading(false);
      return;
    }
    const { data: metricData } = await supabase
      .from("edition_market_metrics")
      .select("edition_id,currency,market_value_median,verified_sale_count,latest_sale_date")
      .in("edition_id", ids);
    setMetrics((metricData ?? []) as Metric[]);
    setLoading(false);
  }

  useEffect(() => {
    queueMicrotask(() => { void loadPortfolio(); });
    const { data: listener } = supabase.auth.onAuthStateChange(() => { void loadPortfolio(); });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userEmail || query.trim().length < 2 || selectedEdition) {
      return;
    }
    const safeQuery = query.trim().replace(/[,%()]/g, " ");
    const timer = window.setTimeout(async () => {
      const { data } = await supabase
        .from("manga_editions")
        .select("id,title,series,volume_number,language,isbn_13,edition_statement,printing_number,variant_name")
        .or(`title.ilike.%${safeQuery}%,series.ilike.%${safeQuery}%,isbn_13.ilike.%${safeQuery}%`)
        .eq("is_verified", true)
        .limit(8);
      setSuggestions((data ?? []) as Edition[]);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, selectedEdition, userEmail]);

  useEffect(() => {
    if (!userEmail || !initialEditionId || selectedEdition || editingId) return;
    const loadRequestedEdition = async () => {
      const { data } = await supabase
        .from("manga_editions")
        .select("id,title,series,volume_number,language,isbn_13,edition_statement,printing_number,variant_name")
        .eq("id", initialEditionId)
        .eq("is_verified", true)
        .maybeSingle();
      if (data) setSelectedEdition(data as Edition);
    };
    void loadRequestedEdition();
  }, [editingId, initialEditionId, selectedEdition, userEmail]);

  const metricsByEdition = useMemo(() => {
    const mapped = new Map<string, Metric[]>();
    for (const metric of metrics) mapped.set(metric.edition_id, [...(mapped.get(metric.edition_id) ?? []), metric]);
    return mapped;
  }, [metrics]);
  const paidTotals = useMemo(() => totalsByCurrency(holdings.flatMap((holding) => holding.purchase_price !== null && holding.purchase_currency ? [{ value: holding.purchase_price * holding.quantity, currency: holding.purchase_currency }] : [])), [holdings]);
  const marketTotals = useMemo(() => totalsByCurrency(holdings.flatMap((holding) => (metricsByEdition.get(holding.edition_id) ?? []).map((metric) => ({ value: metric.market_value_median * holding.quantity, currency: metric.currency })))), [holdings, metricsByEdition]);
  const unvaluedCount = holdings.filter((holding) => !(metricsByEdition.get(holding.edition_id)?.length)).length;

  function resetForm() {
    setSelectedEdition(null); setEditingId(null); setQuery(""); setSuggestions([]); setQuantity("1"); setPurchasePrice(""); setPurchaseCurrency("GBP"); setPurchaseDate(""); setNotes("");
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthMessage("");
    if (mode === "sign-up") {
      const destination = `${window.location.origin}/portfolio${initialEditionId ? `?edition=${encodeURIComponent(initialEditionId)}` : ""}`;
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: destination } });
      if (error) setAuthMessage(error.message);
      else if (data.session) setAuthMessage("Your account is ready.");
      else setAuthMessage("Check your email to confirm your account, then sign in.");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthMessage(error.message);
  }

  async function saveHolding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEdition) { setMessage("Choose a RAR edition first."); return; }
    const nextQuantity = Number(quantity);
    const nextPrice = purchasePrice.trim() ? Number(purchasePrice) : null;
    if (!Number.isInteger(nextQuantity) || nextQuantity < 1 || (nextPrice !== null && (!Number.isFinite(nextPrice) || nextPrice < 0))) {
      setMessage("Use a whole quantity and a valid non-negative purchase price."); return;
    }
    setSaving(true); setMessage("");
    const values = { edition_id: selectedEdition.id, quantity: nextQuantity, purchase_price: nextPrice, purchase_currency: nextPrice === null ? null : purchaseCurrency.toUpperCase(), purchase_date: purchaseDate || null, notes: notes.trim() || null, updated_at: new Date().toISOString() };
    const result = editingId ? await supabase.from("portfolio_holdings").update(values).eq("id", editingId) : await supabase.from("portfolio_holdings").insert(values);
    if (result.error) setMessage(result.error.code === "23505" ? "This edition is already in your portfolio. Edit that holding instead." : "Your holding could not be saved.");
    else { resetForm(); await loadPortfolio(); }
    setSaving(false);
  }

  function editHolding(holding: Holding) {
    if (!holding.edition) return;
    setSelectedEdition(holding.edition); setEditingId(holding.id); setQuantity(String(holding.quantity)); setPurchasePrice(holding.purchase_price?.toString() ?? ""); setPurchaseCurrency(holding.purchase_currency ?? "GBP"); setPurchaseDate(holding.purchase_date ?? ""); setNotes(holding.notes ?? ""); setQuery(""); setSuggestions([]); setMessage("");
  }

  async function removeHolding(id: string) {
    if (!window.confirm("Remove this holding from your portfolio?")) return;
    const { error } = await supabase.from("portfolio_holdings").delete().eq("id", id);
    if (error) setMessage("This holding could not be removed.");
    else { if (editingId === id) resetForm(); await loadPortfolio(); }
  }

  async function signOut() { await supabase.auth.signOut(); resetForm(); }

  return <main className="portfolio-page public-page">
    <header className="site-header"><Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>{userEmail ? <button className="portfolio-signout" onClick={() => void signOut()}>Sign out</button> : <span className="header-note">Private collecting, evidence first</span>}</header>
    {!userEmail ? <section className="portfolio-auth"><div><p className="eyebrow">RAR Portfolio</p><h1>Know what you own.</h1><p>Private holdings, linked to RAR&apos;s edition records and the market evidence behind them.</p><ul className="portfolio-benefits"><li>Track the exact RAR editions you own.</li><li>Keep purchase details private.</li><li>See market evidence only when it is verified.</li></ul>{initialEditionId ? <p className="portfolio-add-context">You&apos;re adding a specific RAR edition. Create an account or sign in, then it will be ready to add.</p> : <p className="portfolio-add-context">Create a free account to keep your holdings private and available across devices.</p>}</div><form className="portfolio-auth-form" onSubmit={submitAuth}><div className="portfolio-auth-options" aria-label="Portfolio access"><button className={mode === "sign-up" ? "selected" : ""} type="button" onClick={() => { setMode("sign-up"); setAuthMessage(""); }}>Create free account</button><button className={mode === "sign-in" ? "selected" : ""} type="button" onClick={() => { setMode("sign-in"); setAuthMessage(""); }}>Sign in</button></div><p className="eyebrow">{mode === "sign-in" ? "Welcome back" : "Start your private portfolio"}</p><label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label><label>Password<input type="password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} /></label><button type="submit">{mode === "sign-in" ? "Sign in" : "Create free account"}</button>{authMessage ? <p role="status">{authMessage}</p> : null}</form></section> : <>
      <section className="portfolio-hero"><div><p className="eyebrow">Your private collection</p><h1>Portfolio</h1><p>{userEmail}</p></div><div className="portfolio-count"><strong>{holdings.length}</strong><span>editions tracked</span></div></section>
      <section className="portfolio-content"><div className="portfolio-summary"><div><span>Total paid</span><MoneySummary totals={paidTotals} empty="Add purchase prices" /></div><div><span>RAR market evidence</span><MoneySummary totals={marketTotals} empty="Still being verified" /></div><div><span>Unvalued editions</span><strong>{unvaluedCount}</strong><small>RAR will not estimate without verified comparable sales.</small></div></div>
        <div className="portfolio-grid"><section className="portfolio-holdings"><div className="section-intro"><p className="eyebrow">Your collection</p><h2>Holdings</h2></div>{loading ? <p className="status-message">Loading your private portfolio...</p> : holdings.length ? <div className="portfolio-list">{holdings.map((holding) => { const editionMetrics = metricsByEdition.get(holding.edition_id) ?? []; return <article className="portfolio-holding" key={holding.id}><div><p className="card-kicker">{holding.quantity} {holding.quantity === 1 ? "copy" : "copies"}</p><Link href={`/edition/${holding.edition_id}`}><h3>{holding.edition?.title ?? "Edition"}</h3></Link><p>{holding.edition ? [holding.edition.series, holding.edition.volume_number ? `Vol. ${holding.edition.volume_number}` : null, holding.edition.language, holding.edition.isbn_13 ? `ISBN ${holding.edition.isbn_13}` : null].filter(Boolean).join(" | ") : "RAR edition"}</p>{holding.notes ? <small>{holding.notes}</small> : null}</div><div className="portfolio-holding-value"><span>RAR evidence</span>{editionMetrics.length ? editionMetrics.map((metric) => <strong key={metric.currency}>{formatMoney(metric.market_value_median * holding.quantity, metric.currency)}<small>{metric.verified_sale_count} verified sale{metric.verified_sale_count === 1 ? "" : "s"}</small></strong>) : <strong className="portfolio-no-value">Not enough data<small>No verified comparable sale yet</small></strong>}{holding.purchase_price !== null && holding.purchase_currency ? <p>Paid {formatMoney(holding.purchase_price * holding.quantity, holding.purchase_currency)}</p> : null}<div><button onClick={() => editHolding(holding)}>Edit</button><button onClick={() => void removeHolding(holding.id)}>Remove</button></div></div></article>; })}</div> : <p className="status-message">Add your first RAR edition. Your portfolio will stay private and only use records already in the RAR catalogue.</p>}</section>
          <aside className="portfolio-form-panel"><p className="eyebrow">{editingId ? "Edit holding" : "Add to portfolio"}</p><h2>{editingId ? "Update holding" : "Track an edition"}</h2><p>Only verified RAR editions can be added. Raw condition remains on the original sale source; it is not a portfolio valuation field.</p><form onSubmit={saveHolding}><label>RAR edition{selectedEdition ? <div className="portfolio-selected-edition"><strong>{editionLabel(selectedEdition)}</strong><button type="button" onClick={resetForm}>Change</button></div> : <><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title or ISBN" autoComplete="off" />{visibleSuggestions.length ? <div className="portfolio-suggestions">{visibleSuggestions.map((edition) => <button type="button" key={edition.id} onClick={() => { setSelectedEdition(edition); setSuggestions([]); setQuery(""); }}>{editionLabel(edition)}</button>)}</div> : null}</>}</label><label>Quantity<input type="number" min="1" step="1" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label>Purchase price per copy <small>Optional</small><input type="number" min="0" step="0.01" value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} /></label><label>Purchase currency<input value={purchaseCurrency} maxLength={3} disabled={!purchasePrice.trim()} onChange={(event) => setPurchaseCurrency(event.target.value.toUpperCase())} /></label><label>Purchase date <small>Optional</small><input type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} /></label><label>Notes <small>Optional</small><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Where you found it, personal note, etc." /></label><div className="portfolio-form-actions"><button disabled={saving} type="submit">{saving ? "Saving..." : editingId ? "Save holding" : "Add holding"}</button>{editingId ? <button type="button" className="portfolio-text-button" onClick={resetForm}>Cancel</button> : null}</div>{message ? <p role="status">{message}</p> : null}</form></aside></div></section>
    </>}
  </main>;
}
