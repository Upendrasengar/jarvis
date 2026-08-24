// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Three-state theme: dark · light · system. "system" follows the OS via
// prefers-color-scheme, live — the html.light class stays the single switch
// every component (and the JS palette mirrors) already key off.
export type ThemeMode = "dark" | "light" | "system";

const KEY = "jarvis_theme";
const mq = () => window.matchMedia("(prefers-color-scheme: light)");

export function themeMode(): ThemeMode {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "system" ? v : "dark";
}

export function applyTheme(mode: ThemeMode) {
  const light = mode === "light" || (mode === "system" && mq().matches);
  document.documentElement.classList.toggle("light", light);
}

export function setThemeMode(mode: ThemeMode) {
  localStorage.setItem(KEY, mode);
  applyTheme(mode);
}

// boot: apply before first paint and follow OS changes while in system mode
export function initTheme() {
  applyTheme(themeMode());
  mq().addEventListener("change", () => {
    if (themeMode() === "system") applyTheme("system");
  });
}
