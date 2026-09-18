// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Three-state theme: dark · light · system. "system" follows the OS via
// prefers-color-scheme, live — the html.light class stays the single switch
// every component (and the JS palette mirrors) already key off.
import { cachedUiState, fetchUiState, saveUiState } from "../lib/uiState";

export type ThemeMode = "dark" | "light" | "system";

// Legacy per-origin key. Still READ so an existing browser keeps its theme on
// first load after this change, then migrated to the server and never written
// again — otherwise the two copies drift and the older one wins at random.
const KEY = "jarvis_theme";
const mq = () => window.matchMedia("(prefers-color-scheme: light)");

export function themeMode(): ThemeMode {
  const v = cachedUiState().theme ?? localStorage.getItem(KEY);
  return v === "light" || v === "system" ? v : "dark";
}

export function applyTheme(mode: ThemeMode) {
  const light = mode === "light" || (mode === "system" && mq().matches);
  document.documentElement.classList.toggle("light", light);
}

export function setThemeMode(mode: ThemeMode) {
  saveUiState({ theme: mode });
  applyTheme(mode);
}

// boot: apply before first paint and follow OS changes while in system mode
export function initTheme() {
  applyTheme(themeMode());              // from cache, before first paint
  mq().addEventListener("change", () => {
    if (themeMode() === "system") applyTheme("system");
  });

  // Then reconcile with the server, which is what makes the native window and
  // the browser agree despite being different origins. A first load in a new
  // window has no cache, so this is where its theme actually comes from.
  void fetchUiState()
    .then((s) => {
      if (s.theme) return applyTheme(s.theme);
      // Nothing stored yet: adopt whatever this origin had, so the very first
      // load after upgrading does not reset a theme the owner already chose.
      const legacy = localStorage.getItem(KEY);
      if (legacy === "light" || legacy === "system" || legacy === "dark")
        saveUiState({ theme: legacy });
    })
    .catch(() => {});                   // server down: the cache already painted
}
