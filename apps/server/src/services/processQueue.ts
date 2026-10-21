// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Processing queue — WHEN a finished call gets transcribed, and the controls
// over sessions the live watcher does not own.
//
// The decisions live in bash (tools/process-queue.sh decides, tools/call-watch.sh
// --heal sweeps orphans); this file only reads the state they write and asks
// them to act. Two implementations of "is now a good time" would drift.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import type { ProcessPolicy, ProcessQueueState } from "@jarvis/shared";
import { CALLS_DIR, JARVIS_DIR, MEMORY_DIR } from "../config.js";
import { WORKER_PATH } from "./env.js";
import { signalWatcher } from "../integrations/watcher.js";

const POLICY_FILE = path.join(MEMORY_DIR, "settings", "process-policy.txt");
const PAUSE_FILE = path.join(JARVIS_DIR, "data", "process-pause");
const STATE_FILE = path.join(JARVIS_DIR, "data", "process-queue.json");
const QUEUE_SH = path.join(JARVIS_DIR, "tools", "process-queue.sh");
const WATCH_SH = path.join(JARVIS_DIR, "tools", "call-watch.sh");
const STALE_MS = 90_000;   // the watcher ticks every ~60s; older = watcher down

function run(cmd: string, args: string[], timeout = 20_000): Promise<string> {
  return new Promise((resolve) =>
    execFile("/bin/bash", [cmd, ...args], {
      cwd: JARVIS_DIR, timeout, env: { ...process.env, PATH: WORKER_PATH },
    }, (_err, stdout) => resolve(String(stdout ?? ""))));
}

export function readPolicy(): ProcessPolicy {
  let line = "";
  try { line = fs.readFileSync(POLICY_FILE, "utf8").split("\n")[0].trim().toLowerCase(); } catch {}
  const m = line.match(/^window (\d{2}:\d{2}-\d{2}:\d{2})$/);
  if (m) return { mode: "window", window: m[1] };
  if (line === "idle" || line === "manual" || line === "now") return { mode: line };
  return { mode: "now" };   // absent/garbage = the pre-queue behaviour
}

export async function setPolicy(p: ProcessPolicy): Promise<ProcessQueueState> {
  const line = p.mode === "window" ? `window ${p.window ?? "21:00-06:00"}` : p.mode;
  try {
    fs.mkdirSync(path.dirname(POLICY_FILE), { recursive: true });
    fs.writeFileSync(POLICY_FILE, line + "\n");
  } catch {}
  return refreshState();
}

/** A pause overrides every mode. It always expires — a forgotten pause would
 *  silently stop notes from ever being written. */
export async function setPause(on: boolean, ms = 60 * 60e3): Promise<ProcessQueueState> {
  try {
    fs.mkdirSync(path.dirname(PAUSE_FILE), { recursive: true });
    if (!on) fs.rmSync(PAUSE_FILE, { force: true });
    else fs.writeFileSync(PAUSE_FILE, String(Math.floor((Date.now() + ms) / 1000)) + "\n");
  } catch {}
  return refreshState();
}

function readStateFile(): ProcessQueueState | null {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return j && typeof j === "object" ? (j as ProcessQueueState) : null;
  } catch { return null; }
}

/** Ask the script to re-evaluate and rewrite the state file, then read it. */
export async function refreshState(): Promise<ProcessQueueState> {
  await run(QUEUE_SH, ["status"]);
  return readStateFile() ?? emptyState();
}

function emptyState(): ProcessQueueState {
  return {
    updatedAt: 0, policy: readPolicy(), pausedUntil: 0, running: null,
    pending: [], waiting: "", idleSecs: 0, power: "unknown",
  };
}

/** Current state: the watcher's last tick, or a fresh evaluation when that
 *  is stale (watcher down) or missing (first run after upgrade). */
export async function queueState(): Promise<ProcessQueueState> {
  const s = readStateFile();
  if (s && Date.now() - s.updatedAt < STALE_MS) return s;
  return refreshState();
}

// ── session controls ──────────────────────────────────────────────────────

function sessionEnded(id: string): boolean {
  try { return /^ended:/m.test(fs.readFileSync(path.join(CALLS_DIR, id, "meta.txt"), "utf8")); }
  catch { return true; }   // no meta = nothing is recording into it
}

function watcherOwns(id: string): Promise<boolean> {
  let pid = "";
  try { pid = fs.readFileSync(path.join(CALLS_DIR, id, ".watcher"), "utf8").trim(); } catch {}
  if (!/^\d+$/.test(pid)) return Promise.resolve(false);
  return new Promise((resolve) =>
    execFile("/bin/ps", ["-o", "command=", "-p", pid], (err, out) =>
      resolve(!err && /call-watch/.test(String(out)))));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Stop recording a specific session. Owned by the live watcher → signal it
 * (USR1), which also sweeps orphans. Not owned (its watcher died) → the sweep
 * alone, so a stuck card never stops a real call that is recording in
 * another session. Waits briefly for the "ended:" line so the caller can
 * act on a finished session.
 */
export async function stopSession(id: string): Promise<{ ok: true } | { error: string }> {
  if (sessionEnded(id)) return { ok: true };
  if (await watcherOwns(id)) {
    const r = await signalWatcher("stop");
    if ("error" in r) await run(WATCH_SH, ["--heal"]);
  } else {
    await run(WATCH_SH, ["--heal"]);
  }
  for (let i = 0; i < 16 && !sessionEnded(id); i++) await sleep(500);
  return sessionEnded(id) ? { ok: true } : { error: "could not stop the recording — check reports/callwatch.log" };
}

/** Stop with no target: the live watcher's current recording, plus orphans. */
export async function stopAny(): Promise<{ ok: true } | { error: string }> {
  const r = await signalWatcher("stop");
  // the watcher being down is exactly when orphans exist — sweep regardless
  await run(WATCH_SH, ["--heal"]);
  return "error" in r ? { ok: true } : r;
}

/** Kill a processor working on this session (and its whisper child). */
export async function killProcessing(id: string): Promise<void> {
  await run(QUEUE_SH, ["kill", id]);
}

/** Process now, policy aside, at normal priority — the owner is waiting. */
export async function processNow(id: string): Promise<void> {
  await run(QUEUE_SH, ["now", id]);
}
