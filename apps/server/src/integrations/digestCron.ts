// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Daily digest scheduler — lives in the server instead of launchd.
// Why: launchd agents can't read scripts under ~/Documents (macOS TCC)
// without Full Disk Access, which broke the 8am digest the moment the repo
// moved there. The server already runs with the user's file access, so it
// schedules the digest itself: every few minutes it checks "is it past the
// digest hour and today's digest doesn't exist?" — which also means a Mac
// that was asleep at 8:00 gets its digest at wake instead of never.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { DIGESTS_DIR, JARVIS_DIR, REPORTS_DIR, setting } from "../config.js";

const CHECK_MS = 5 * 60_000;
let running = false;

function localDate(d: Date): string {
  return d.toLocaleDateString("sv-SE");   // YYYY-MM-DD in local time
}

function check() {
  if (running) return;
  const hour = Number(setting("digest-hour") ?? 8);
  const now = new Date();
  if (now.getHours() < hour) return;
  const target = path.join(DIGESTS_DIR, `digest-${localDate(now)}.md`);
  if (fs.existsSync(target)) return;

  running = true;
  const out = fs.openSync(path.join(REPORTS_DIR, "cron.log"), "a");
  fs.writeSync(out, `[digest-cron] ${now.toTimeString().slice(0, 8)} generating ${path.basename(target)}\n`);
  const child = spawn("/bin/bash", [path.join(JARVIS_DIR, "tools", "run-digest.sh")], {
    cwd: JARVIS_DIR,
    stdio: ["ignore", out, out],
  });
  child.on("exit", (code) => {
    try { fs.writeSync(out, `[digest-cron] finished (exit ${code})\n`); fs.closeSync(out); } catch {}
    running = false;
  });
  child.on("error", () => { try { fs.closeSync(out); } catch {} running = false; });
}

export function startDigestCron() {
  setTimeout(check, 60_000);              // one check shortly after boot
  setInterval(check, CHECK_MS).unref();
}
