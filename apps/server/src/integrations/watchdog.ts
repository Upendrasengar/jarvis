// Watcher watchdog — the server supervises tools/call-watch.sh. Two failure
// modes, both auto-healed:
//   dead   — process gone (crash, kill): restart it
//   wedged — process alive but heartbeat stale (e.g. blocked on an
//            unkillable recorder, the 3-hour incident): kill -9 + restart
// Restarts are logged into reports/callwatch.log so the Activity page shows
// what happened. The watcher's startup healing sweep then finalizes any
// session the wedge left behind.
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { JARVIS_DIR, REPORTS_DIR } from "../config.js";

const HEARTBEAT = path.join(JARVIS_DIR, "data", "watcher-heartbeat");
const LOG = path.join(REPORTS_DIR, "callwatch.log");
const STALE_MS = 150_000;   // watcher beats every ~15s; 2.5min = wedged
const CHECK_MS = 60_000;

let restarting = false;

// [c]all-watch: the bracket keeps the pattern from matching any command line
// that merely CONTAINS this pattern as text (a shell running this very pgrep,
// an editor open on the file) — only a real watcher process matches
const WATCHER_RE = "bash.*[c]all-watch\\.sh";

function watcherAlive(): Promise<boolean> {
  return new Promise((resolve) =>
    execFile("/usr/bin/pgrep", ["-f", WATCHER_RE], (err) => resolve(!err)));
}

function logLine(msg: string) {
  const t = new Date().toTimeString().slice(0, 8);
  try { fs.appendFileSync(LOG, `${t} watchdog: ${msg}\n`); } catch {}
}

function restartWatcher(reason: string) {
  if (restarting) return;
  restarting = true;
  logLine(`restarting watcher — ${reason}`);
  execFile("/usr/bin/pkill", ["-9", "-f", WATCHER_RE], () => {
    setTimeout(() => {
      try {
        const out = fs.openSync(LOG, "a");
        const child = spawn("/bin/bash", [path.join(JARVIS_DIR, "tools", "call-watch.sh")], {
          detached: true,
          stdio: ["ignore", out, out],
          cwd: JARVIS_DIR,
        });
        child.unref();
        fs.closeSync(out);
      } catch (e) {
        logLine(`restart FAILED: ${String(e).slice(0, 100)}`);
      }
      setTimeout(() => { restarting = false; }, 10_000);
    }, 1500);
  });
}

export function startWatchdog() {
  setInterval(async () => {
    const alive = await watcherAlive();
    if (!alive) { restartWatcher("process not running"); return; }
    let beat = 0;
    try { beat = fs.statSync(HEARTBEAT).mtimeMs; } catch {}
    if (beat && Date.now() - beat > STALE_MS) {
      restartWatcher(`wedged — heartbeat stale ${Math.round((Date.now() - beat) / 1000)}s`);
    }
    // no heartbeat file yet (old watcher build): leave it alone
  }, CHECK_MS).unref();
}
