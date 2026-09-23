// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// UI state that belongs to the OWNER, not to a browser.
//
// Theme and chat session lived in localStorage, which is scoped to an origin.
// The native window loads http://127.0.0.1:PORT and a browser loads
// http://localhost:PORT — different origins, so the app opened with the
// default theme and an empty conversation while the browser still had both.
// Nothing was lost; they were in a different drawer.
//
// Anything a person would describe as "my Jarvis looks like this" or "the
// conversation I was having" belongs on the server. Per-device conveniences
// (which microphone is armed) do not, and stay client-side.
import fs from "node:fs";
import path from "node:path";
import { JARVIS_DIR } from "../config.js";

const FILE = path.join(JARVIS_DIR, "data", "ui-state.json");

// Deliberately a small, closed set rather than an open key-value store: this
// is written by a browser, and an unbounded bag on disk invites growth nobody
// reviews.
export type UiState = {
  theme?: "dark" | "light" | "system";
  session?: string;
  voice?: "on" | "off";
};

// null = any string (session ids are opaque); a list = the only values that
// field may hold. The type above already says this; saying it again in data
// is what lets the reader ENFORCE it, and is why the loop below now
// typechecks — assigning one `string` across three different field types
// never could.
const FIELDS: { [K in keyof UiState]-?: readonly string[] | null } = {
  theme: ["dark", "light", "system"],
  session: null,
  voice: ["on", "off"],
};

export function readUiState(): UiState {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const out: Record<string, string> = {};
    for (const [k, allowed] of Object.entries(FIELDS)) {
      const v = raw?.[k];
      if (typeof v !== "string") continue;
      if (allowed && !allowed.includes(v)) continue;   // a stale or hand-edited value
      out[k] = v;
    }
    return out as UiState;
  } catch {
    return {};                        // absent or corrupt reads as "no preference"
  }
}

export function patchUiState(patch: UiState): UiState {
  const next = { ...readUiState(), ...patch };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  // Write-then-rename: a half-written file here would reset someone's theme
  // and lose the conversation they were in the middle of.
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, FILE);
  return next;
}
