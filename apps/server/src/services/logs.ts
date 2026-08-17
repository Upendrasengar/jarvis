// Activity & logs — visibility into the pipelines so "transcribing…" is
// never a mystery. Log ids map to a fixed set of known files (never arbitrary
// paths): the watcher log, the server log, and each call session's
// process.log.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { CALLS_DIR, REPORTS_DIR } from "../config.js";

export type LogSource = { id: string; label: string; updated: number | null };

function mtime(p: string): number | null {
  try { return fs.statSync(p).mtimeMs; } catch { return null; }
}

function resolveLog(id: string): string | null {
  if (id === "watcher") return path.join(REPORTS_DIR, "callwatch.log");
  if (id === "server") return path.join(REPORTS_DIR, "api.log");
  const m = id.match(/^call:([\w-]+)$/);
  if (m) return path.join(CALLS_DIR, m[1], "process.log");
  return null;
}

export function listLogs(): LogSource[] {
  const out: LogSource[] = [
    { id: "watcher", label: "Call watcher", updated: mtime(path.join(REPORTS_DIR, "callwatch.log")) },
    { id: "server", label: "Server", updated: mtime(path.join(REPORTS_DIR, "api.log")) },
  ];
  try {
    const sessions = fs.readdirSync(CALLS_DIR)
      .filter((d) => fs.existsSync(path.join(CALLS_DIR, d, "process.log")))
      .sort().reverse().slice(0, 10);
    for (const d of sessions) {
      out.push({
        id: `call:${d}`,
        label: `Call ${d}`,
        updated: mtime(path.join(CALLS_DIR, d, "process.log")),
      });
    }
  } catch {}
  return out;
}

export function tailLog(id: string, lines = 200): { text: string; updated: number | null } {
  const p = resolveLog(id);
  if (!p) return { text: "unknown log", updated: null };
  try {
    const raw = fs.readFileSync(p, "utf8");
    const all = raw.split("\n");
    return { text: all.slice(-lines).join("\n"), updated: mtime(p) };
  } catch {
    return { text: "(no log yet)", updated: null };
  }
}

// Which pipeline processes are alive right now.
export function activity(): Promise<{ whisper: boolean; processor: boolean; recorder: boolean; claude: boolean }> {
  const check = (pattern: string) =>
    new Promise<boolean>((resolve) =>
      execFile("/usr/bin/pgrep", ["-f", pattern], (err) => resolve(!err)));
  return Promise.all([
    check("whisper-cli"),
    check("process-call\\.sh"),
    check("call-capture/bin/audiocap"),
    check("claude -p"),
  ]).then(([whisper, processor, recorder, claude]) => ({ whisper, processor, recorder, claude }));
}
