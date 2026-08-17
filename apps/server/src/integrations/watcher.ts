// Control channel to tools/call-watch.sh — the recorder daemon is owned by
// the shell pipeline; the server only signals it (USR1 = stop the current
// recording now, USR2 = start one now).
import { execFile } from "node:child_process";

export function signalWatcher(action: "stop" | "start"): Promise<{ ok: true } | { error: string }> {
  const sig = action === "stop" ? "-USR1" : "-USR2";
  return new Promise((resolve) => {
    execFile("/usr/bin/pkill", [sig, "-f", "bash.*call-watch\\.sh"], (err) =>
      resolve(err ? { error: "call watcher is not running" } : { ok: true }));
  });
}
