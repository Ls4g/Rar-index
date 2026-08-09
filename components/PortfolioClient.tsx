"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { type FxRate } from "@/lib/fx";
import {
  computeEditionMetrics,
  familyIdsFor,
  resolvePublicationFamily,
  type ValuationSale,
} from "@/lib/portfolioValuation";
import ThemeToggle from "@/components/ThemeToggle";
import MarketCurrencyProvider from "@/components/MarketCurrencyProvider";
import PortfolioAuth from "@/components/portfolio/PortfolioAuth";
import PortfolioTabs, { type PortfolioTabKey } from "@/components/portfolio/PortfolioTabs";
import OverviewTab from "@/components/portfolio/OverviewTab";
import HoldingsTab from "@/components/portfolio/HoldingsTab";
import PerformanceTab from "@/components/portfolio/PerformanceTab";
import { type SummaryMetric } from "@/components/portfolio/PortfolioSummary";
import { type Holding, type HoldingEdition } from "@/components/portfolio/HoldingCard";
import HoldingModal from "@/components/portfolio/HoldingModal";
import { type LiveListingActivity, type RecentHoldingActivity, type RecentSaleActivity } from "@/components/portfolio/ActivityFeed";
import { type PortfolioSnapshotPoint } from "@/components/portfolio/PortfolioValueChart";
import CollectorUsernameControl from "@/components/portfolio/CollectorUsernameControl";

const RECENT_HOLDINGS_LIMIT = 5;
const RECENT_SALES_LIMIT = 6;
const SNAPSHOT_HISTORY_LIMIT = 400;

export default function PortfolioClient({ initialEditionId = "" }: { initialEditionId?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-up");
  const [authMessage, setAuthMessage] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PortfolioTabKey>("overview");
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [metrics, setMetrics] = useState<SummaryMetric[]>([]);
  const [otherSaleCounts, setOtherSaleCounts] = useState<Map<string, number>>(new Map());
  const [recentSales, setRecentSales] = useState<RecentSaleActivity[]>([]);
  const [rates, setRates] = useState<FxRate[]>([]);
  const [snapshots, setSnapshots] = useState<PortfolioSnapshotPoint[]>([]);
  const [liveListings, setLiveListings] = useState<LiveListingActivity[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<HoldingEdition[]>([]);
  const [selectedEdition, setSelectedEdition] = useState<HoldingEdition | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [purchaseCurrency, setPurchaseCurrency] = useState("GBP");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadPortfolio() {
    setLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    setUserEmail(user?.email ?? null);
    setUserId(user?.id ?? null);
    if (!user) {
      setHoldings([]);
      setMetrics([]);
      setOtherSaleCounts(new Map());
      setRecentSales([]);
      setRates([]);
      setSnapshots([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("portfolio_holdings")
      .select("id,edition_id,quantity,purchase_price,purchase_currency,purchase_date,notes,created_at,edition:manga_editions(id,title,series,volume_number,language,isbn_13,edition_statement,printing_number,variant_name,printing_of_edition_id,cover_image_url,cover_verification_status)")
      .order("created_at", { ascending: false });
    if (error) {
      setMessage("Your holdings could not be loaded. Please try again.");
      setLoading(false);
      return;
    }
    const nextHoldings = (data ?? []) as unknown as Array<Holding & { created_at: string }>;
    setHoldings(nextHoldings);

    const { data: snapshotData } = await supabase
      .from("portfolio_snapshots")
      .select("id,snapshot_at,display_currency,total_paid,total_evidence_value,gain_loss_amount,gain_loss_percent,holdings_total_count,holdings_valued_count,holdings_unvalued_count,trigger_reason")
      .order("snapshot_at", { ascending: true })
      .limit(SNAPSHOT_HISTORY_LIMIT);
    setSnapshots((snapshotData ?? []) as PortfolioSnapshotPoint[]);

    const ids = nextHoldings.map((holding) => holding.edition_id);
    if (!ids.length) {
      setMetrics([]);
      setOtherSaleCounts(new Map());
      setRecentSales([]);
      setRates([]);
      setLoading(false);
      return;
    }
    const publicationIds = [...new Set(nextHoldings.map((holding) => holding.edition?.printing_of_edition_id ?? holding.edition_id))];
    const { data: childrenData } = await supabase.from("manga_editions").select("id,printing_of_edition_id").in("printing_of_edition_id", publicationIds);
    const children = (childrenData ?? []) as Array<{ id: string; printing_of_edition_id: string | null }>;
    const { publicationByMember } = resolvePublicationFamily(nextHoldings, children);
    const familyIds = familyIdsFor(nextHoldings, publicationIds, children);

    const { data: salesData } = familyIds.length
      ? await supabase
        .from("price_observations")
        .select("edition_id,sale_price,currency,sold_date,print_classification")
        .in("edition_id", familyIds)
        .eq("sale_status", "confirmed")
        .eq("match_status", "verified_match")
      : { data: [] };
    const sales = (salesData ?? []) as ValuationSale[];

    const { metrics: nextMetrics, otherSaleCounts: nextOtherCounts } = computeEditionMetrics(nextHoldings, sales, publicationByMember);
    setMetrics(nextMetrics);
    setOtherSaleCounts(nextOtherCounts);

    // For activity display, a sale on a family member (e.g. a print-run
    // child) is shown under whichever of the user's own holdings represents
    // that same publication — never a raw internal id the user never chose.
    const holdingByPublicationId = new Map<string, Holding>();
    for (const holding of nextHoldings) {
      const publicationId = holding.edition?.printing_of_edition_id ?? holding.edition_id;
      if (!holdingByPublicationId.has(publicationId)) holdingByPublicationId.set(publicationId, holding);
    }
    const nextRecentSales: RecentSaleActivity[] = [...sales]
      .sort((a, b) => (b.sold_date ?? "").localeCompare(a.sold_date ?? ""))
      .flatMap((sale) => {
        const publicationId = publicationByMember.get(sale.edition_id) ?? sale.edition_id;
        const holding = holdingByPublicationId.get(publicationId);
        if (!holding) return [];
        return [{
          editionId: holding.edition_id,
          editionTitle: holding.edition?.title ?? null,
          salePrice: sale.sale_price,
          currency: sale.currency,
          soldDate: sale.sold_date,
          classification: sale.print_classification,
        }];
      })
      .slice(0, RECENT_SALES_LIMIT);
    setRecentSales(nextRecentSales);

    const rateCurrencies = [...new Set(["GBP", "USD", "EUR",
      ...nextHoldings.flatMap((holding) => holding.purchase_currency ? [holding.purchase_currency] : []),
      ...nextMetrics.map((metric) => metric.currency),
    ])];
    const { data: fxRatesData } = await supabase
      .from("exchange_rates")
      .select("rate_date, currency, rate_per_eur, source_name, source_url")
      .in("currency", rateCurrencies)
      .order("rate_date", { ascending: true })
      .limit(2000);
    setRates((fxRatesData ?? []) as FxRate[]);
    setLoading(false);
  }

  useEffect(() => {
    queueMicrotask(() => { void loadPortfolio(); });
    const { data: listener } = supabase.auth.onAuthStateChange(() => { void loadPortfolio(); });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Scout listings for the user's own editions — a separate, lightweight
  // call (not the anon Supabase client) since scout_listing_leads needs
  // elevated access; the same data is already public on each edition page.
  const holdingEditionIds = useMemo(() => [...new Set(holdings.map((holding) => holding.edition_id))], [holdings]);
  useEffect(() => {
    if (!holdingEditionIds.length) return;
    const controller = new AbortController();
    queueMicrotask(() => setListingsLoading(true));
    const editionIds = holdingEditionIds;
    fetch("/api/portfolio-activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editionIds }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json() as { listings?: Array<{ id: string; editionId: string; editionTitle: string | null; listingTitle: string; sourceListingUrl: string; listingPrice: number | null; currency: string | null }> };
        setLiveListings(result.listings ?? []);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setLiveListings([]);
      })
      .finally(() => setListingsLoading(false));
    return () => controller.abort();
  }, [holdingEditionIds]);
  // holdingEditionIds only ever shrinks to empty when every holding is
  // removed, at which point liveListings would otherwise show stale data
  // from before — derive the displayed value instead of clearing it via a
  // second effect.
  const visibleLiveListings = holdingEditionIds.length ? liveListings : [];

  useEffect(() => {
    if (!userEmail || query.trim().length < 2 || selectedEdition) {
      return;
    }
    const safeQuery = query.trim().replace(/[,%()]/g, " ");
    const timer = window.setTimeout(async () => {
      const { data } = await supabase
        .from("manga_editions")
        .select("id,title,series,volume_number,language,isbn_13,edition_statement,printing_number,variant_name,printing_of_edition_id")
        .or(`title.ilike.%${safeQuery}%,series.ilike.%${safeQuery}%,isbn_13.ilike.%${safeQuery}%`)
        .eq("is_verified", true)
        .eq("record_kind", "publication")
        .limit(8);
      setSuggestions((data ?? []) as HoldingEdition[]);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, selectedEdition, userEmail]);

  useEffect(() => {
    if (!userEmail || !initialEditionId || selectedEdition || editingId) return;
    const loadRequestedEdition = async () => {
      const { data } = await supabase
        .from("manga_editions")
        .select("id,title,series,volume_number,language,isbn_13,edition_statement,printing_number,variant_name,printing_of_edition_id")
        .eq("id", initialEditionId)
        .eq("is_verified", true)
        .maybeSingle();
      if (data) { setSelectedEdition(data as HoldingEdition); setModalOpen(true); }
    };
    void loadRequestedEdition();
  }, [editingId, initialEditionId, selectedEdition, userEmail]);

  const metricsByEdition = useMemo(() => {
    const mapped = new Map<string, SummaryMetric[]>();
    for (const metric of metrics) mapped.set(metric.edition_id, [...(mapped.get(metric.edition_id) ?? []), metric]);
    return mapped;
  }, [metrics]);

  const recentHoldingsActivity: RecentHoldingActivity[] = useMemo(() => (
    (holdings as Array<Holding & { created_at?: string }>)
      .filter((holding) => holding.created_at)
      .slice(0, RECENT_HOLDINGS_LIMIT)
      .map((holding) => ({ holdingId: holding.id, editionId: holding.edition_id, editionTitle: holding.edition?.title ?? null, addedAt: holding.created_at as string }))
  ), [holdings]);

  function resetForm() {
    setSelectedEdition(null); setEditingId(null); setQuery(""); setSuggestions([]); setQuantity("1"); setPurchasePrice(""); setPurchaseCurrency("GBP"); setPurchaseDate(""); setNotes(""); setMessage("");
  }

  function openAddModal() {
    resetForm();
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    resetForm();
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

  // Fires a snapshot in the background after a holding changes -- no button,
  // no loading state, no visible step. Best-effort: the holding CRUD above
  // has already succeeded and is already reflected in the live-computed
  // value on screen regardless of whether this call succeeds.
  async function triggerBackgroundSnapshot(reason: "holding_added" | "holding_updated" | "holding_removed") {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;
      await fetch("/api/portfolio-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason }),
      });
    } catch {
      // Ignored -- see comment above.
    }
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
    const wasEditing = Boolean(editingId);
    const values = { edition_id: selectedEdition.id, quantity: nextQuantity, purchase_price: nextPrice, purchase_currency: nextPrice === null ? null : purchaseCurrency.toUpperCase(), purchase_date: purchaseDate || null, notes: notes.trim() || null, updated_at: new Date().toISOString() };
    const result = editingId ? await supabase.from("portfolio_holdings").update(values).eq("id", editingId) : await supabase.from("portfolio_holdings").insert(values);
    if (result.error) setMessage(result.error.code === "23505" ? "This edition is already in your portfolio. Edit that holding instead." : "Your holding could not be saved.");
    else {
      setModalOpen(false); resetForm(); await loadPortfolio();
      void triggerBackgroundSnapshot(wasEditing ? "holding_updated" : "holding_added");
    }
    setSaving(false);
  }

  function editHolding(holding: Holding) {
    if (!holding.edition) return;
    setSelectedEdition(holding.edition); setEditingId(holding.id); setQuantity(String(holding.quantity)); setPurchasePrice(holding.purchase_price?.toString() ?? ""); setPurchaseCurrency(holding.purchase_currency ?? "GBP"); setPurchaseDate(holding.purchase_date ?? ""); setNotes(holding.notes ?? ""); setQuery(""); setSuggestions([]); setMessage(""); setModalOpen(true);
  }

  async function removeHolding(id: string) {
    if (!window.confirm("Remove this holding from your portfolio?")) return;
    const { error } = await supabase.from("portfolio_holdings").delete().eq("id", id);
    if (error) setMessage("This holding could not be removed.");
    else {
      if (editingId === id) closeModal();
      await loadPortfolio();
      void triggerBackgroundSnapshot("holding_removed");
    }
  }

  async function signOut() { await supabase.auth.signOut(); resetForm(); }

  return <main className="portfolio-page public-page">
    <header className="site-header">
      <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
      <div className="header-links">
        {userEmail && userId ? <CollectorUsernameControl userId={userId} /> : null}
        {userEmail ? <button className="portfolio-signout" onClick={() => void signOut()}>Sign out</button> : <span className="header-note">Private collecting, evidence first</span>}
        <ThemeToggle />
      </div>
    </header>

    {!userEmail ? (
      <PortfolioAuth authMessage={authMessage} email={email} initialEditionId={initialEditionId} mode={mode} onSubmit={submitAuth} password={password} setEmail={setEmail} setMode={setMode} setPassword={setPassword} />
    ) : (
      <MarketCurrencyProvider>
        <section className="portfolio-content">
          <PortfolioTabs active={activeTab} onChange={setActiveTab} />

          {activeTab === "overview" ? (
            <OverviewTab
              holdings={holdings}
              liveListings={visibleLiveListings}
              listingsLoading={listingsLoading}
              metricsByEdition={metricsByEdition}
              onAddClick={openAddModal}
              rates={rates}
              recentHoldings={recentHoldingsActivity}
              recentSales={recentSales}
              snapshots={snapshots}
            />
          ) : null}

          {activeTab === "holdings" ? (
            <HoldingsTab
              holdings={holdings}
              loading={loading}
              metricsByEdition={metricsByEdition}
              onAddClick={openAddModal}
              onEdit={editHolding}
              onRemove={(id) => void removeHolding(id)}
              otherSaleCounts={otherSaleCounts}
              rates={rates}
            />
          ) : null}

          {activeTab === "performance" ? (
            <PerformanceTab snapshots={snapshots} />
          ) : null}
        </section>

        <HoldingModal
          editingId={editingId}
          message={message}
          notes={notes}
          onChangeEdition={() => { setSelectedEdition(null); setQuery(""); }}
          onClose={closeModal}
          onSelectEdition={(edition) => { setSelectedEdition(edition); setSuggestions([]); setQuery(""); }}
          onSubmit={saveHolding}
          open={modalOpen}
          purchaseCurrency={purchaseCurrency}
          purchaseDate={purchaseDate}
          purchasePrice={purchasePrice}
          quantity={quantity}
          query={query}
          saving={saving}
          selectedEdition={selectedEdition}
          setNotes={setNotes}
          setPurchaseCurrency={setPurchaseCurrency}
          setPurchaseDate={setPurchaseDate}
          setPurchasePrice={setPurchasePrice}
          setQuantity={setQuantity}
          setQuery={setQuery}
          suggestions={suggestions}
        />
      </MarketCurrencyProvider>
    )}
  </main>;
}
