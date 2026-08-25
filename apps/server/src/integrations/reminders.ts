// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Reminders + heartbeat — an openclaw-style scheduler living in the server.
// Jobs are a JSON file (data/reminders.json) so everything is inspectable
// and revertible; the server ticks every 30s. Two payload kinds:
//   message   — deterministic nudge: macOS notification + Telegram
//   agentTurn — a prompt run through the tool-less dispatcher WITH a
//               server-assembled context block (overdue actions, upcoming
//               meetings, failed calls); replies starting HEARTBEAT_OK are
//               suppressed — you only hear from it when something matters.
// The chat dispatcher creates jobs via the ACTION:REMIND protocol (same
// pattern as ACTION:DELEGATE); the API below serves the UI and workers.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { CALLS_DIR, JARVIS_DIR, MEMORY_DIR, MEMORY_MD_DIR, setting } from "../config.js";
import { sendTurn } from "../services/chatSessions.js";
import { listActions } from "../services/actions.js";

const FILE = path.join(JARVIS_DIR, "data", "reminders.json");
const SESSION = "reminders";
const TICK_MS = 30_000;
const HEARTBEAT_ID = "heartbeat";

export type Schedule =
  | { kind: "at"; at: string }              // "YYYY-MM-DD HH:MM" local, one-shot
  | { kind: "cron"; expr: string }          // 5-field cron, local time
  | { kind: "every"; everyMs: number };
export type Payload =
  | { kind: "message"; text: string }
  | { kind: "agentTurn"; prompt: string };
export type Job = {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  schedule: Schedule;
  payload: Payload;
  state: { lastRunAt?: string; lastStatus?: string; lastFiredKey?: string; nextRunAt?: number };
};

// the heartbeat's own memory: what it already sent today. Without this,
// every pulse is a fresh session that happily re-nags the same item all
// day (the "seven Niharika reminders" incident).
const SENT_LOG = path.join(JARVIS_DIR, "data", "heartbeat-log.json");
function loadSent(): Array<{ at: string; text: string }> {
  try { return JSON.parse(fs.readFileSync(SENT_LOG, "utf8")); } catch { return []; }
}
function logSent(text: string) {
  const log = loadSent().slice(-29);
  log.push({ at: new Date().toISOString(), text: text.slice(0, 250) });
  try { fs.writeFileSync(SENT_LOG, JSON.stringify(log, null, 1)); } catch {}
}

// telegram registers its sender at startup — avoids a circular import
let sender: ((text: string) => Promise<void>) | null = null;
export function setReminderSender(fn: (text: string) => Promise<void>) { sender = fn; }

function load(): { version: number; jobs: Job[] } {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { return { version: 1, jobs: [] }; }
}
function save(db: { version: number; jobs: Job[] }) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

// ── cron (5 fields: min hour dom mon dow; * lists ranges steps; local time)
function partMatches(part: string, v: number, lo0: number, hi0: number): boolean {
  const m = part.match(/^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/);
  if (!m) return false;
  const step = m[4] ? parseInt(m[4], 10) : 1;
  const lo = m[1] === "*" ? lo0 : parseInt(m[2], 10);
  const hi = m[1] === "*" ? hi0 : m[3] ? parseInt(m[3], 10) : m[4] ? hi0 : parseInt(m[2], 10);
  return v >= lo && v <= hi && (v - lo) % step === 0;
}
export function cronMatches(expr: string, d: Date): boolean {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return false;
  const vals = [d.getMinutes(), d.getHours(), d.getDate(), d.getMonth() + 1, d.getDay()];
  const lo = [0, 0, 1, 1, 0];
  const hi = [59, 23, 31, 12, 6];
  return f.every((field, i) =>
    field.split(",").some(
      (p) => partMatches(p, vals[i], lo[i], hi[i]) || (i === 4 && vals[i] === 0 && partMatches(p, 7, 0, 7)),
    ));
}

function notify(text: string) {
  const body = text.length > 180 ? text.slice(0, 180) + "…" : text;
  execFile("osascript", ["-e",
    `display notification ${JSON.stringify(body)} with title "Jarvis" sound name "Glass"`,
  ], () => {});
}

async function deliver(text: string) {
  notify(text);
  if (sender) await sender(text).catch(() => {});
}

// ── heartbeat context: the dispatcher is tool-less, so the server gathers
// the facts and the model only judges what deserves a nudge
function heartbeatContext(): string {
  const now = new Date();
  const today = now.toLocaleDateString("sv-SE");
  const lines: string[] = [`Now: ${now.toString()}`];
  try {
    const triage = JSON.parse(fs.readFileSync(path.join(JARVIS_DIR, "data", "triage.json"), "utf8"));
    const open = listActions().filter((a) => !a.done);
    const overdue = open.filter((a) => {
      const d = triage?.deadlines?.[`${a.callId}|${a.index}`];
      return d && d < today;
    });
    const dueToday = open.filter((a) => triage?.deadlines?.[`${a.callId}|${a.index}`] === today);
    if (overdue.length)
      lines.push(`OVERDUE action items (${overdue.length}): ` +
        overdue.slice(0, 6).map((a) => `${a.owner ? a.owner + ": " : ""}${a.text.replace(/\*\*/g, "").slice(0, 90)}`).join(" | "));
    if (dueToday.length)
      lines.push(`DUE TODAY (${dueToday.length}): ` +
        dueToday.slice(0, 6).map((a) => `${a.owner ? a.owner + ": " : ""}${a.text.replace(/\*\*/g, "").slice(0, 90)}`).join(" | "));
  } catch {}
  try {
    const cal = JSON.parse(fs.readFileSync(path.join(JARVIS_DIR, "data", "calendar.json"), "utf8"));
    const soon = (cal?.events ?? []).filter((e: any) => {
      const t = new Date((e.start ?? "").replace(" ", "T")).getTime();
      return Number.isFinite(t) && t > now.getTime() && t - now.getTime() < 25 * 60_000;
    });
    if (soon.length)
      lines.push("MEETINGS starting within 25 min: " +
        soon.map((e: any) => `${e.subject ?? "meeting"} at ${(e.start ?? "").slice(11, 16)}`).join(" | "));
  } catch {}
  try {
    const failed = fs.readdirSync(CALLS_DIR).filter((d) => {
      try { return fs.existsSync(path.join(CALLS_DIR, d, "FAILED.txt")); } catch { return false; }
    });
    if (failed.length) lines.push(`FAILED call processing: ${failed.join(", ")} (rerunnable from the Calls page)`);
  } catch {}
  const today2 = new Date().toLocaleDateString("sv-SE");
  const sent = loadSent().filter((e) => e.at.slice(0, 10) === today2 ||
    new Date(e.at).toLocaleDateString("sv-SE") === today2);
  if (sent.length)
    lines.push("ALREADY SENT TODAY (yours — do NOT re-send these topics):\n" +
      sent.map((e) => `  [${new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}] ${e.text}`).join("\n"));
  return lines.join("\n");
}

function runAgent(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    let acc = "";
    const r = sendTurn(SESSION, prompt, {
      onText: (t) => { acc += t; },
      onDone: (finalText) => resolve((finalText ?? acc).trim()),
    });
    if (r.busy) resolve("");    // previous heartbeat still running — skip
  });
}

async function fire(j: Job): Promise<string> {
  if (j.payload.kind === "message") {
    await deliver(`⏰ ${j.name}\n${j.payload.text}`);
    return "ok";
  }
  const context = j.id === HEARTBEAT_ID ? `\n\n=== CURRENT STATE (server-gathered) ===\n${heartbeatContext()}` : "";
  const out = await runAgent(
    j.payload.prompt + context +
    "\n\nHARD RULES: an item that appears in ALREADY SENT TODAY must NOT be mentioned again unless its status materially changed since (e.g. it just became overdue, or a meeting moved). Maximum twice per day for any single item — once to flag it, once near end of day if still open. If everything you would flag is already covered, reply with exactly HEARTBEAT_OK and nothing else. If nothing genuinely needs the owner's attention right now, reply HEARTBEAT_OK.",
  );
  if (!out || /^HEARTBEAT_OK\b/.test(out)) return "quiet";
  await deliver(out);
  if (j.id === HEARTBEAT_ID) logSent(out);
  return "ok";
}

// heartbeat quiet hours: "22-8" (local) — setting file overrides
function inQuietHours(d: Date): boolean {
  const [a, b] = (setting("heartbeat-quiet") ?? "22-8").split("-").map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const h = d.getHours();
  return a <= b ? h >= a && h < b : h >= a || h < b;
}

function tick() {
  const now = new Date();
  const db = load();
  let dirty = false;
  const localKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}`;

  for (const j of db.jobs) {
    if (!j.enabled) continue;
    if (j.id === HEARTBEAT_ID && inQuietHours(now)) continue;
    let due = false;
    if (j.schedule.kind === "cron") {
      due = cronMatches(j.schedule.expr, now) && j.state.lastFiredKey !== localKey;
      if (due) j.state.lastFiredKey = localKey;
    } else if (j.schedule.kind === "at") {
      const t = new Date(j.schedule.at.replace(" ", "T")).getTime();
      due = Number.isFinite(t) && now.getTime() >= t;
      if (due) j.enabled = false;             // one-shot: fire once, keep for the record
    } else {
      const next = j.state.nextRunAt ?? Date.parse(j.createdAt) + j.schedule.everyMs;
      due = now.getTime() >= next;
      if (due) j.state.nextRunAt = now.getTime() + j.schedule.everyMs;
    }
    if (!due) continue;
    dirty = true;
    j.state.lastRunAt = now.toISOString();
    j.state.lastStatus = "running";
    const id = j.id;
    fire(j)
      .catch(() => "error")
      .then((st) => {
        const db2 = load();
        const jj = db2.jobs.find((x) => x.id === id);
        if (jj) { jj.state.lastStatus = st as string; save(db2); }
      });
  }
  if (dirty) save(db);
}

// ── public API (routes + ACTION:REMIND use this)
export function listReminders(): Job[] {
  return load().jobs;
}

export function createReminder(input: {
  name: string; schedule: Schedule; payload: Payload;
}): Job {
  const job: Job = {
    id: crypto.randomUUID(),
    name: input.name.slice(0, 120),
    enabled: true,
    createdAt: new Date().toISOString(),
    schedule: input.schedule,
    payload: input.payload,
    state: {},
  };
  // sanity: cron must parse, at must be a future-ish date
  if (job.schedule.kind === "cron" && !cronMatches(job.schedule.expr, new Date(2026, 0, 1, 0, 0)) &&
      job.schedule.expr.trim().split(/\s+/).length !== 5)
    throw new Error("bad cron expression");
  if (job.schedule.kind === "at" && !Number.isFinite(new Date(job.schedule.at.replace(" ", "T")).getTime()))
    throw new Error("bad timestamp");
  const db = load();
  db.jobs.push(job);
  save(db);
  return job;
}

export function deleteReminder(id: string): boolean {
  const db = load();
  const before = db.jobs.length;
  db.jobs = db.jobs.filter((j) => j.id !== id);
  save(db);
  return db.jobs.length < before;
}

export function toggleReminder(id: string): Job | null {
  const db = load();
  const j = db.jobs.find((x) => x.id === id);
  if (!j) return null;
  j.enabled = !j.enabled;
  save(db);
  return j;
}

// the ACTION:REMIND payload from the dispatcher: {name, schedule, message}
export function createFromAction(raw: any): Job {
  if (!raw || typeof raw.name !== "string" || !raw.schedule || typeof raw.message !== "string")
    throw new Error("bad remind action");
  return createReminder({
    name: raw.name,
    schedule: raw.schedule,
    payload: { kind: "message", text: raw.message },
  });
}

// a starter heartbeat: created once; the owner edits memory/HEARTBEAT.md to
// tune it, and can disable the job from the API/UI
const DEFAULT_HEARTBEAT_MD = `# Jarvis heartbeat

You are running as a background pulse. Below this file the server appends a
CURRENT STATE block with real data. Decide if ANYTHING needs the owner's
attention RIGHT NOW. Message ONLY when it matters:

- A meeting starts within ~15-25 minutes → one-line heads-up (subject + time).
- An action item is overdue or due today and hasn't been nudged today.
- Call processing failed (audio kept, needs a rerun).

Style: one short message, plain language, no markdown. Never repeat the same
nudge twice in a row — if you already flagged it this morning, stay quiet.
If nothing qualifies: HEARTBEAT_OK
`;

function ensureHeartbeat() {
  const md = path.join(MEMORY_MD_DIR, "HEARTBEAT.md");
  try { if (!fs.existsSync(md)) fs.writeFileSync(md, DEFAULT_HEARTBEAT_MD); } catch {}
  const db = load();
  if (db.jobs.some((j) => j.id === HEARTBEAT_ID)) return;
  const everyMin = Number(setting("heartbeat-minutes") ?? 45);
  db.jobs.push({
    id: HEARTBEAT_ID,
    name: "Heartbeat — proactive check",
    enabled: true,
    createdAt: new Date().toISOString(),
    schedule: { kind: "every", everyMs: Math.max(10, everyMin) * 60_000 },
    payload: {
      kind: "agentTurn",
      prompt: (() => { try { return fs.readFileSync(md, "utf8"); } catch { return DEFAULT_HEARTBEAT_MD; } })(),
    },
    state: {},
  });
  save(db);
  console.log(`[reminders] heartbeat installed (every ${everyMin}m, quiet ${setting("heartbeat-quiet") ?? "22-8"})`);
}

export function startReminders() {
  ensureHeartbeat();
  // heartbeat prompt follows the file — re-read at every start
  try {
    const md = fs.readFileSync(path.join(MEMORY_MD_DIR, "HEARTBEAT.md"), "utf8");
    const db = load();
    const hb = db.jobs.find((j) => j.id === HEARTBEAT_ID);
    if (hb && hb.payload.kind === "agentTurn" && hb.payload.prompt !== md) {
      hb.payload.prompt = md;
      save(db);
    }
  } catch {}
  setInterval(tick, TICK_MS).unref();
  console.log(`[reminders] scheduler ticking (${load().jobs.length} job(s))`);
}
