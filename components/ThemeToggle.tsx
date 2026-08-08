"use client";

import { useSyncExternalStore } from "react";
import { applyTheme, readCurrentTheme, type Theme } from "@/lib/theme";

function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function getServerSnapshot(): Theme {
  return "night";
}

export default function ThemeToggle() {
  // The inline bootstrap script in app/layout.tsx sets data-theme before
  // paint, so this only ever mismatches the server snapshot ("night")
  // during the instant before hydration completes.
  const theme = useSyncExternalStore(subscribe, readCurrentTheme, getServerSnapshot);

  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      <button
        type="button"
        className={theme === "night" ? "is-active" : ""}
        aria-pressed={theme === "night"}
        onClick={() => applyTheme("night")}
      >
        Night
      </button>
      <button
        type="button"
        className={theme === "day" ? "is-active" : ""}
        aria-pressed={theme === "day"}
        onClick={() => applyTheme("day")}
      >
        Day
      </button>
    </div>
  );
}
