// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Owner UI state, stored on the server so it does not depend on which origin
// the page happens to be served from.
//
// localStorage does not go away — it becomes a CACHE, not the record. The
// server is authoritative but arrives a network round-trip late, and applying
// the theme late means painting the wrong one first. So: paint from cache
// immediately, reconcile when the server answers.
export type UiState = {
  theme?: "dark" | "light" | "system";
  session?: string;
  voice?: "on" | "off";
};

const CACHE = "jarvis_ui_state";

export function cachedUiState(): UiState {
  try { return JSON.parse(localStorage.getItem(CACHE) ?? "{}"); } catch { return {}; }
}

function writeCache(s: UiState) {
  try { localStorage.setItem(CACHE, JSON.stringify(s)); } catch {}
}

export async function fetchUiState(): Promise<UiState> {
  const r = await fetch("/api/ui-state");
  if (!r.ok) throw new Error(`ui-state ${r.status}`);
  const s = (await r.json()) as UiState;
  writeCache(s);
  return s;
}

// Cache first so a later read is correct even if the request fails, then
// persist. A failed save must not silently revert what the user just chose.
export function saveUiState(patch: UiState): void {
  writeCache({ ...cachedUiState(), ...patch });
  void fetch("/api/ui-state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  }).catch(() => {});
}
