"use client";

import { createContext, useContext, useState } from "react";
import type { DisplayCurrency } from "@/lib/fx";

const MarketCurrencyContext = createContext<{
  currency: DisplayCurrency;
  setCurrency: (currency: DisplayCurrency) => void;
} | null>(null);

export default function MarketCurrencyProvider({ children, initialCurrency = "GBP" }: { children: React.ReactNode; initialCurrency?: DisplayCurrency }) {
  const [currency, setCurrency] = useState<DisplayCurrency>(initialCurrency);
  return <MarketCurrencyContext.Provider value={{ currency, setCurrency }}>{children}</MarketCurrencyContext.Provider>;
}

export function useMarketCurrency() {
  const context = useContext(MarketCurrencyContext);
  if (!context) throw new Error("useMarketCurrency must be used within MarketCurrencyProvider");
  return context;
}
