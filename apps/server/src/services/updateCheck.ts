// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// "There is a newer Jarvis" — checked once a day, against what is actually
// installed.
//
// This is the first request Jarvis makes on its own behalf. Everything else it
// contacts is something the owner configured: the Claude API, a calendar feed.
// So it is deliberately narrow — one unauthenticated GET to the public
// releases endpoint, nothing sent, nothing identifying, and a settings file
// that turns it off.
//
// It also fails silently. An update check that produces an error banner when
// the wifi drops is worse than no update check.
import fs from "node:fs";
import path from "node:path";
import { JARVIS_DIR } from "../config.js";

const CACHE = path.join(JARVIS_DIR, "data", "update-check.json");
const ENDPOINT = "https://api.github.com/repos/upendrasengar/jarvis/releases/latest";
const DAY_MS = 24 * 60 * 60 * 1000;

export type UpdateState = { latest: string | null; checkedAt: number; enabled: boolean };

function enabled(): boolean {
  try {
    const v = fs.readFileSync(path.join(JARVIS_DIR, "memory", "settings", "update-check.txt"), "utf8")
      .trim().toLowerCase();
    return !(v === "off" || v === "no" || v === "0" || v === "false");
  } catch {
    return true;                       // absent file means default-on
  }
}

function readCache(): UpdateState | null {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE, "utf8"));
    if (typeof c?.checkedAt === "number") return c;
  } catch { /* absent or corrupt reads as "never checked" */ }
  return null;
}

function writeCache(s: UpdateState): void {
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(s, null, 2));
  } catch { /* a cache that cannot be written just means checking again later */ }
}

// Compare release tags numerically. "v0.3.9" is OLDER than "v0.3.10", which a
// string comparison gets backwards — and getting it backwards would tell
// someone on the newest build that they are behind.
export function isNewer(latest: string, current: string): boolean {
  const parts = (s: string) =>
    s.replace(/^v/, "").split(/[.-]/).map((n) => parseInt(n, 10)).filter((n) => !Number.isNaN(n));
  const a = parts(latest), b = parts(current);
  if (!a.length || !b.length) return false;     // unparseable: say nothing
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

// Non-blocking by design: callers get whatever is cached, and a stale cache
// triggers a refresh in the background. No request is ever on the path of a
// page load.
export function updateState(): UpdateState {
  const off: UpdateState = { latest: null, checkedAt: 0, enabled: false };
  if (!enabled()) return off;
  const cached = readCache();
  const fresh = cached && Date.now() - cached.checkedAt < DAY_MS;
  if (!fresh) void refresh();
  return cached ?? { latest: null, checkedAt: 0, enabled: true };
}

let inFlight = false;
async function refresh(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(ENDPOINT, {
      signal: ctl.signal,
      headers: { accept: "application/vnd.github+json", "user-agent": "jarvis" },
    });
    clearTimeout(t);
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { tag_name?: string };
    const tag = typeof j.tag_name === "string" ? j.tag_name : null;
    writeCache({ latest: tag, checkedAt: Date.now(), enabled: true });
  } catch {
    // Record the attempt even on failure, or a machine that is offline retries
    // on every single request for as long as it stays offline.
    writeCache({ latest: readCache()?.latest ?? null, checkedAt: Date.now(), enabled: true });
  } finally {
    inFlight = false;
  }
}
