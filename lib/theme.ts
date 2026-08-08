// Keep THEME_STORAGE_KEY in sync with the inline bootstrap script in
// app/layout.tsx, which cannot import this module (it runs as raw text
// before any JS bundle loads).
export const THEME_STORAGE_KEY = "rar-theme";
export const THEME_COOKIE_NAME = "rar-theme";

export type Theme = "night" | "day";

export function isTheme(value: unknown): value is Theme {
  return value === "night" || value === "day";
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private browsing, disabled storage). The
    // cookie below still lets the choice persist for this session.
  }
  document.cookie = `${THEME_COOKIE_NAME}=${theme}; path=/; max-age=31536000; SameSite=Lax`;
}

export function readCurrentTheme(): Theme {
  const attribute = document.documentElement.getAttribute("data-theme");
  return isTheme(attribute) ? attribute : "night";
}
