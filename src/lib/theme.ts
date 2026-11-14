import { normalizeSettings, type Theme } from "./settings.ts";

/**
 * The theme lives in synced settings, which load asynchronously. A copy in localStorage
 * (shared by the extension's pages) lets a page pick the right colors before first paint.
 */
const CACHE_KEY = "theme";

/** Sets `data-theme` on <html>; "system" removes it so the CSS follows prefers-color-scheme. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    localStorage.setItem(CACHE_KEY, theme);
  } catch {
    // Storage blocked: the page still themes itself once settings load.
  }
}

/** Applies the saved theme now and follows changes made on the options page. */
export function initTheme(): void {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached === "light" || cached === "dark") document.documentElement.dataset.theme = cached;
  } catch {
    // Fall through to the synced setting.
  }
  void chrome.storage.sync
    .get("settings")
    .then(({ settings }) => applyTheme(normalizeSettings(settings).theme));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings) {
      applyTheme(normalizeSettings(changes.settings.newValue).theme);
    }
  });
}
