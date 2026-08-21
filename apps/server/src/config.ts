// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Central path configuration. The server lives in apps/server inside the
// jarvis repo; all data (reports, memory, vaults) stays where the shell
// pipeline in tools/ writes it — the server is a reader/controller, never
// the owner of that data.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// apps/server/src (dev via tsx) and apps/server/dist (built) are both three
// levels below the repo root.
export const JARVIS_DIR =
  process.env.JARVIS_DIR ?? path.resolve(import.meta.dirname, "..", "..", "..");

export const WEB_DIST = path.join(JARVIS_DIR, "apps", "web", "dist");

export const REPORTS_DIR = path.join(JARVIS_DIR, "reports");
export const CALLS_DIR = path.join(REPORTS_DIR, "calls");
export const MEMORY_DIR = path.join(JARVIS_DIR, "memory");

// User-configurable single-value settings: memory/settings/<name>.txt holds
// one value on its first line (~ expands to home). Shell tools read the same
// files — this is the shared config layer.
export function setting(name: string): string | null {
  try {
    const v = fs
      .readFileSync(path.join(MEMORY_DIR, "settings", `${name}.txt`), "utf8")
      .split("\n")[0]
      .trim()
      .replace(/^~(?=$|\/)/, os.homedir());
    return v || null;
  } catch {
    return null;
  }
}

// The brain: Jarvis's own growing knowledge vault (markdown; Obsidian-
// compatible). Defaults to brain/ inside the repo (gitignored user data);
// point memory/settings/brain-dir.txt at an existing vault to graft Jarvis
// onto your second brain.
export const BRAIN_DIR = setting("brain-dir") ?? path.join(JARVIS_DIR, "brain");
export const BRAIN_CALLS_DIR = path.join(BRAIN_DIR, "Calls");

// Optional: a vault holding one page per project powers the Projects tab.
// Defaults to the brain so the tab works out of the box.
export const PROJECTS_VAULT = setting("projects-vault") ?? BRAIN_DIR;

// Port precedence: JARVIS_API_PORT env > memory/settings/port.txt > 4321
// (dev runs on 4322 with Vite on 5173 proxying to it).
export const PORT = Number(process.env.JARVIS_API_PORT ?? setting("port") ?? 4321);
