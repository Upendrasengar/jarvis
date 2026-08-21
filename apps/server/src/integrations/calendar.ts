// Calendar adapter — fully OPTIONAL and detachable.
// The single switch is CALENDAR_FEED_URL in gitignored secrets/.env:
//   absent  → no polling, no API data, no UI, no digest section. Zero footprint.
//   present → poll every 30 min; accepts either JSON (an array of events, e.g.
//             from a Power Automate HTTP-trigger flow) or a standard ICS feed
//             (Google Calendar / Outlook "secret address"). Normalized events
//             land in data/calendar.json for the digest and the dashboard.
// Feed failures keep the last good data and log quietly — the rest of Jarvis
// never depends on this file existing.
import fs from "node:fs";
import path from "node:path";
import { JARVIS_DIR } from "../config.js";
import { readSecrets } from "../services/env.js";

export type CalEvent = {
  subject: string;
  start: string;        // ISO
  end: string;          // ISO
  organizer?: string;
  attendees: string[];
  location?: string;
  online?: boolean;
};

const FILE = path.join(JARVIS_DIR, "data", "calendar.json");
const POLL_MS = 30 * 60_000;

let state: { enabled: boolean; fetchedAt: string | null; events: CalEvent[] } = {
  enabled: false, fetchedAt: null, events: [],
};

export function calendarState() { return state; }

// ---- ICS parsing (the 20% that covers real feeds) ----
function unfoldICS(text: string): string[] {
  return text.replace(/\r\n[ \t]/g, "").replace(/\r/g, "").split("\n");
}
function icsDate(v: string): string {
  // 20260821T140000Z | 20260821T140000 | 20260821 (all-day)
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return "";
  const [, y, mo, d, h = "00", mi = "00", s = "00", z] = m;
  return z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString()
    : new Date(+y, +mo - 1, +d, +h, +mi, +s).toISOString();
}
function parseICS(text: string): CalEvent[] {
  const out: CalEvent[] = [];
  let ev: Partial<CalEvent> & { attendees: string[] } | null = null;
  for (const line of unfoldICS(text)) {
    if (line === "BEGIN:VEVENT") ev = { attendees: [] };
    else if (line === "END:VEVENT") {
      if (ev?.subject && ev.start) out.push({ end: ev.start, ...ev } as CalEvent);
      ev = null;
    } else if (ev) {
      const [rawKey, ...rest] = line.split(":");
      const value = rest.join(":");
      const key = rawKey.split(";")[0];
      if (key === "SUMMARY") ev.subject = value;
      else if (key === "DTSTART") ev.start = icsDate(value);
      else if (key === "DTEND") ev.end = icsDate(value);
      else if (key === "LOCATION" && value) ev.location = value;
      else if (key === "ORGANIZER") ev.organizer = value.replace(/^mailto:/i, "");
      else if (key === "ATTENDEE") {
        const cn = rawKey.match(/CN=([^;:]+)/)?.[1];
        ev.attendees.push(cn ?? value.replace(/^mailto:/i, ""));
      }
    }
  }
  return out;
}

function normalizeJSON(data: any): CalEvent[] {
  const arr = Array.isArray(data) ? data : data?.value ?? data?.events ?? [];
  return (arr as any[]).map((e) => ({
    subject: String(e.subject ?? e.title ?? "(untitled)"),
    start: String(e.start?.dateTime ?? e.start ?? ""),
    end: String(e.end?.dateTime ?? e.end ?? e.start ?? ""),
    organizer: e.organizer?.emailAddress?.name ?? e.organizer ?? undefined,
    attendees: (e.attendees ?? []).map((a: any) =>
      typeof a === "string" ? a : a.emailAddress?.name ?? a.name ?? a.email ?? "?"),
    location: e.location?.displayName ?? e.location ?? undefined,
    online: !!(e.isOnline ?? e.isOnlineMeeting ?? e.onlineMeeting),
  })).filter((e) => e.subject && e.start);
}

async function poll(url: string) {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json, text/calendar" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    const events = body.trimStart().startsWith("BEGIN:VCALENDAR")
      ? parseICS(body)
      : normalizeJSON(JSON.parse(body));
    // keep a window: yesterday .. +7d, sorted
    const from = Date.now() - 86_400_000, to = Date.now() + 7 * 86_400_000;
    state = {
      enabled: true,
      fetchedAt: new Date().toISOString(),
      events: events
        .filter((e) => { const t = Date.parse(e.start); return t > from && t < to; })
        .sort((a, b) => a.start.localeCompare(b.start)),
    };
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 1));
  } catch (e) {
    console.log(`[calendar] feed fetch failed (${String(e).slice(0, 80)}) — keeping last data`);
  }
}

export function startCalendar() {
  const url = readSecrets().CALENDAR_FEED_URL;
  if (!url) {
    console.log("[calendar] not configured — set CALENDAR_FEED_URL in secrets/.env (optional)");
    try { fs.rmSync(FILE, { force: true }); } catch {}   // stale data never lingers
    return;
  }
  state.enabled = true;
  try { state = { ...JSON.parse(fs.readFileSync(FILE, "utf8")), enabled: true }; } catch {}
  void poll(url);
  setInterval(() => void poll(url), POLL_MS).unref();
  console.log("[calendar] polling feed every 30 min");
}
