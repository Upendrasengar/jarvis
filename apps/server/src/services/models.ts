// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Which model does which job. Kept as three plain files under
// memory/settings/ like every other preference, because the shell pipeline
// (process-call.sh, run-digest.sh, triage-actions.sh) reads them directly and
// cannot call into this module.
//
// The split follows CLAUDE.md's routing table rather than offering one global
// switch: Opus on the note-distiller is pure cost, while the conversation is
// where a stronger model is actually felt.
import fs from "node:fs";
import path from "node:path";
import { MEMORY_DIR } from "../config.js";

export type ModelRole = "chat" | "worker" | "quick";

const FILE: Record<ModelRole, string> = {
  chat: "model-chat.txt",
  worker: "model-worker.txt",
  quick: "model-quick.txt",
};

// Today's hardcoded behaviour, so an install with no settings files is
// unchanged by this becoming configurable.
const DEFAULT: Record<ModelRole, string> = {
  chat: "sonnet",
  worker: "sonnet",
  quick: "haiku",
};

const ALLOWED = new Set(["haiku", "sonnet", "opus"]);

export function modelFor(role: ModelRole): string {
  let v = "";
  try {
    v = fs.readFileSync(path.join(MEMORY_DIR, "settings", FILE[role]), "utf8")
      .split("\n")[0].trim().toLowerCase();
  } catch { /* not configured */ }
  // An unrecognised value falls back rather than reaching the CLI: a typo in
  // a settings file should not take the whole surface down.
  return ALLOWED.has(v) ? v : DEFAULT[role];
}

export function setModel(role: ModelRole, value: string): void {
  const v = String(value).trim().toLowerCase();
  if (!ALLOWED.has(v)) throw new Error(`unknown model tier: ${value}`);
  const dir = path.join(MEMORY_DIR, "settings");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, FILE[role]), `${v}\n`);
}
