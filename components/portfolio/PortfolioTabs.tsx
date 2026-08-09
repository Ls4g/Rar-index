"use client";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export type PortfolioTabKey = "overview" | "holdings" | "performance";

const TABS: Array<{ key: PortfolioTabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "holdings", label: "Holdings" },
  { key: "performance", label: "Performance" },
];

type PortfolioTabsProps = {
  active: PortfolioTabKey;
  onChange: (tab: PortfolioTabKey) => void;
};

export default function PortfolioTabs({ active, onChange }: PortfolioTabsProps) {
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((tab) => tab.key === active);
    if (event.key === "ArrowRight") { event.preventDefault(); onChange(TABS[(index + 1) % TABS.length].key); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); onChange(TABS[(index - 1 + TABS.length) % TABS.length].key); }
    else if (event.key === "Home") { event.preventDefault(); onChange(TABS[0].key); }
    else if (event.key === "End") { event.preventDefault(); onChange(TABS.at(-1)!.key); }
  }

  return (
    <div className="portfolio-tabs" role="tablist" aria-label="Portfolio sections" onKeyDown={handleKeyDown}>
      {TABS.map((tab) => (
        <button
          aria-controls={`portfolio-panel-${tab.key}`}
          aria-selected={active === tab.key}
          className={active === tab.key ? "is-active" : ""}
          id={`portfolio-tab-${tab.key}`}
          key={tab.key}
          onClick={() => onChange(tab.key)}
          role="tab"
          tabIndex={active === tab.key ? 0 : -1}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
