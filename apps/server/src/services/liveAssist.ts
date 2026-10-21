// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Live assist supervisor. The work happens in tools/live-assist.sh (slice the
// growing recording, small whisper, quick model → <session>/live/assist.json);
// this file decides whether that script should be running for the session
// being recorded, starts and stops it, and reads what it wrote.
//
// Supervised from here rather than from the watcher so the switch can be
// flipped mid-call from the UI without the watcher learning about it, and so
// a watcher restart does not touch it. The script exits on its own when the
// call ends, so the worst a missed tick can do is leave a few seconds of
// extra transcription.
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import type { LiveAssistInfo, LiveAssistState, LiveHistoryItem, LiveStatus } from "@jarvis/shared";
import {
  LiveAssistState as LiveAssistStateSchema, LiveHistoryItem as LiveHistoryItemSchema, LiveStatus as LiveStatusSchema,
} from "@jarvis/shared";
import { CALLS_DIR, JARVIS_DIR, MEMORY_DIR } from "../config.js";
import { WORKER_PATH } from "./env.js";

const DEFAULT_FILE = path.join(MEMORY_DIR, "settings", "live-assist.txt");
const SCRIPT = path.join(JARVIS_DIR, "tools", "live-assist.sh");
const ID_RE = /^[\w-]+$/;

const liveDir = (id: string) => path.join(CALLS_DIR, id, "live");

// ── preference ────────────────────────────────────────────────────────────
// Off unless asked for: it runs whisper during the call and streams the
// transcript to the model as it is produced — both are things to opt into.
export function getLiveDefault(): { on: boolean } {
  try { return { on: fs.readFileSync(DEFAULT_FILE, "utf8").trim() === "on" }; }
  catch { return { on: false }; }
}
export function setLiveDefault(on: boolean): { on: boolean } {
  try {
    fs.mkdirSync(path.dirname(DEFAULT_FILE), { recursive: true });
    fs.writeFileSync(DEFAULT_FILE, on ? "on\n" : "off\n");
  } catch {}
  void tick();
  return getLiveDefault();
}

// Per-session override: live/.enabled or live/.disabled. Neither = default.
function sessionFlag(id: string): boolean | null {
  if (fs.existsSync(path.join(liveDir(id), ".enabled"))) return true;
  if (fs.existsSync(path.join(liveDir(id), ".disabled"))) return false;
  return null;
}
function wanted(id: string): boolean {
  return sessionFlag(id) ?? getLiveDefault().on;
}

export async function setLive(id: string, on: boolean): Promise<LiveAssistInfo> {
  if (!ID_RE.test(id)) throw new Error("bad id");
  const dir = liveDir(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(path.join(dir, on ? ".disabled" : ".enabled"), { force: true });
  fs.writeFileSync(path.join(dir, on ? ".enabled" : ".disabled"), "");
  await tick();
  return liveInfo(id);
}

// ── process control ───────────────────────────────────────────────────────
function pidOf(id: string): number {
  try { return Number(fs.readFileSync(path.join(liveDir(id), ".pid"), "utf8").trim()) || 0; }
  catch { return 0; }
}
function isRunning(id: string): Promise<boolean> {
  const pid = pidOf(id);
  if (!pid) return Promise.resolve(false);
  try { process.kill(pid, 0); } catch { return Promise.resolve(false); }
  // pids get reused — the live process must also be the script
  return new Promise((resolve) =>
    execFile("/bin/ps", ["-o", "command=", "-p", String(pid)], (err, out) =>
      resolve(!err && /live-assist/.test(String(out)))));
}

function start(id: string): void {
  const sess = path.join(CALLS_DIR, id);
  const dir = liveDir(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(path.join(dir, ".stop"), { force: true });
  const out = fs.openSync(path.join(dir, "assist.log"), "a");
  const child = spawn("/bin/bash", [SCRIPT, sess], {
    cwd: JARVIS_DIR, detached: true, stdio: ["ignore", out, out],
    env: { ...process.env, PATH: WORKER_PATH, JARVIS_DIR },
  });
  child.unref();
  fs.closeSync(out);
  console.log(`[live-assist] started for ${id} (pid ${child.pid})`);
}

/** Ask the script to stop: a flag it checks every round, plus TERM so it
 *  does not wait the round out. Idempotent. */
export async function killLive(id: string): Promise<void> {
  if (!ID_RE.test(id)) return;
  const dir = liveDir(id);
  try { if (fs.existsSync(dir)) fs.writeFileSync(path.join(dir, ".stop"), ""); } catch {}
  const pid = pidOf(id);
  if (pid && await isRunning(id)) {
    try { process.kill(pid, "SIGTERM"); } catch {}
    console.log(`[live-assist] stopped for ${id} (pid ${pid})`);
  }
}

// Sessions still being recorded: audio present, no "ended:" line. Read
// directly rather than through calls.ts to keep the import graph one-way.
function recordingSessions(): string[] {
  let dirs: string[] = [];
  try { dirs = fs.readdirSync(CALLS_DIR); } catch { return []; }
  return dirs.filter((d) => {
    if (!ID_RE.test(d)) return false;
    const sess = path.join(CALLS_DIR, d);
    let meta = "";
    try { meta = fs.readFileSync(path.join(sess, "meta.txt"), "utf8"); } catch { return false; }
    if (/^ended:/m.test(meta)) return false;
    return ["mic.wav", "system.wav"].some((f) => fs.existsSync(path.join(sess, f)));
  });
}

let ticking = false;
export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const live = new Set(recordingSessions());
    for (const id of live) {
      const want = wanted(id);
      const running = await isRunning(id);
      if (want && !running) start(id);
      else if (!want && running) await killLive(id);
    }
    // a script still alive for a session that is no longer recording (it
    // exits by itself on "ended:", so this only catches a deleted dir or a
    // stuck one)
    let dirs: string[] = [];
    try { dirs = fs.readdirSync(CALLS_DIR); } catch {}
    for (const d of dirs) {
      if (live.has(d) || !ID_RE.test(d)) continue;
      if (fs.existsSync(path.join(liveDir(d), ".pid")) && await isRunning(d)) await killLive(d);
    }
  } finally {
    ticking = false;
  }
}

export function startLiveAssist(): void {
  setInterval(() => { void tick(); }, 10_000).unref();
  void tick();
}

// ── reading ───────────────────────────────────────────────────────────────
function readJson<T>(file: string, schema: { safeParse: (x: unknown) => { success: boolean; data?: T } }): T | null {
  try {
    const r = schema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    return r.success ? (r.data as T) : null;
  } catch { return null; }
}
function tail(file: string, bytes: number): string {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, "r");
    const len = Math.min(bytes, st.size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    const s = buf.toString("utf8");
    // drop a partial first line when we cut into the middle of the file
    return st.size > bytes ? s.slice(s.indexOf("\n") + 1) : s;
  } catch { return ""; }
}
function doneIds(id: string): string[] {
  try {
    return fs.readFileSync(path.join(liveDir(id), "done.txt"), "utf8")
      .split("\n").map((l) => l.trim()).filter(Boolean);
  } catch { return []; }
}

// history.jsonl: one line per model round. Folded into one entry per item
// id — first and last time it was on screen, latest wording — and tagged
// with where it stands now. Oldest first.
function readHistory(id: string, current: Set<string>, done: Set<string>):
  { history: LiveHistoryItem[]; summaries: { at: number; text: string }[] } {
  const items = new Map<string, LiveHistoryItem>();
  const summaries: { at: number; text: string }[] = [];
  let raw = "";
  try { raw = fs.readFileSync(path.join(liveDir(id), "history.jsonl"), "utf8"); } catch { return { history: [], summaries }; }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let r: { at?: number; summary?: string; items?: unknown[] };
    try { r = JSON.parse(line); } catch { continue; }
    const at = Number(r.at) || 0;
    if (r.summary && summaries[summaries.length - 1]?.text !== r.summary) summaries.push({ at, text: String(r.summary) });
    for (const it of r.items ?? []) {
      const p = LiveHistoryItemSchema.omit({ firstAt: true, lastAt: true, status: true }).safeParse(it);
      if (!p.success) continue;
      const prev = items.get(p.data.id);
      items.set(p.data.id, {
        ...p.data, firstAt: prev?.firstAt ?? at, lastAt: at,
        status: done.has(p.data.id) ? "done" : current.has(p.data.id) ? "current" : "earlier",
      });
    }
  }
  return { history: [...items.values()].sort((a, b) => a.firstAt - b.firstAt), summaries };
}

export async function liveInfo(id: string): Promise<LiveAssistInfo> {
  if (!ID_RE.test(id)) throw new Error("bad id");
  const dir = liveDir(id);
  const state = readJson<LiveAssistState>(path.join(dir, "assist.json"), LiveAssistStateSchema);
  const status = readJson<LiveStatus>(path.join(dir, "status.json"), LiveStatusSchema);
  const done = doneIds(id);
  const visible = state ? state.items.filter((i) => !done.includes(i.id)) : [];
  const { history, summaries } = readHistory(id, new Set(visible.map((i) => i.id)), new Set(done));
  return {
    id,
    history,
    summaries,
    enabled: wanted(id),
    running: await isRunning(id),
    defaultOn: getLiveDefault().on,
    state: state ? { ...state, items: visible } : null,
    status,
    transcript: tail(path.join(dir, "transcript.md"), 4000),
    done,
    log: tail(path.join(dir, "assist.log"), 600).trim().split("\n").slice(-3).join("\n"),
  };
}

/** The owner ticked an item off (or un-ticked it). The script reads this
 *  file each round so the model never brings the item back. */
export function markDone(id: string, itemId: string, done: boolean): { ok: true } {
  if (!ID_RE.test(id)) throw new Error("bad id");
  const dir = liveDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const ids = new Set(doneIds(id));
  if (done) ids.add(itemId); else ids.delete(itemId);
  fs.writeFileSync(path.join(dir, "done.txt"), [...ids].join("\n") + (ids.size ? "\n" : ""));
  return { ok: true };
}
