// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Doctor over HTTP, so the browser onboarding can run the same system check
// the CLI does (plan Tasks 2 and 7).
//
// This SPAWNS tools/doctor.sh --json rather than porting its checks. Doctor
// inspects things only a shell can see — brew, node ABI, the claude CLI,
// whisper, TCC grants — and a second implementation would answer differently
// from `jarvis doctor` the moment either changed. One check, two front doors.
import { spawn } from "node:child_process";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { JARVIS_DIR } from "../config.js";
import { WORKER_PATH } from "../services/env.js";

const TIMEOUT_MS = 30_000;
// Doctor takes ~8s, so a page must not run it on every render. Short cache:
// long enough to stop repeat clicks, short enough that fixing something and
// re-checking shows the fix.
const CACHE_MS = 5_000;
let cached: { at: number; body: unknown } | null = null;

function runDoctor(): Promise<unknown> {
  return new Promise((resolve) => {
    const child = spawn("/bin/bash", [path.join(JARVIS_DIR, "tools", "doctor.sh"), "--json"], {
      cwd: JARVIS_DIR,
      env: { ...process.env, PATH: WORKER_PATH },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (b) => { out += String(b); });
    const kill = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(kill);
      resolve({ ok: false, checks: [], error: "doctor could not be started" });
    });
    child.on("close", () => {
      clearTimeout(kill);
      try { resolve(JSON.parse(out)); }
      catch {
        // A partial or empty run must not masquerade as a clean bill of health.
        resolve({ ok: false, checks: [], error: "doctor did not return a readable report" });
      }
    });
  });
}

export function doctorRoutes(app: FastifyInstance) {
  app.get("/api/doctor", async () => {
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.body;
    const body = await runDoctor();
    cached = { at: Date.now(), body };
    return body;
  });
}
