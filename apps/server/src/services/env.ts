// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Shared environment helpers: locating the claude binary, reading gitignored
// secrets, voice preferences, and the readable vault list. Ports of the
// legacy ui/server.js helpers, unchanged in behavior.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JARVIS_DIR, MEMORY_DIR } from "../config.js";

export function findClaude(): string {
  const cands = [
    path.join(os.homedir(), ".local/bin/claude"),
    path.join(os.homedir(), ".nvm/versions/node/v22.12.0/bin/claude"),
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  try {
    const base = path.join(os.homedir(), ".nvm/versions/node");
    for (const d of fs.readdirSync(base).sort().reverse()) {
      const c = path.join(base, d, "bin/claude");
      if (fs.existsSync(c)) return c;
    }
  } catch {}
  return "claude";
}
export const CLAUDE = findClaude();

export const WORKER_PATH = `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ""}`;

export function readSecrets(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [path.join(JARVIS_DIR, "secrets/.env"), path.join(JARVIS_DIR, ".env")]) {
    try {
      for (const line of fs.readFileSync(f, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {}
  }
  return out;
}

// Voice selection lives in memory/settings/voice.txt; presets in memory/settings/voices.txt.
export function currentVoiceId(): string {
  try {
    const v = fs.readFileSync(path.join(MEMORY_DIR, "settings", "voice.txt"), "utf8").trim();
    if (v) return v;
  } catch {}
  return readSecrets().ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
}

export function readVoices(): Record<string, string> {
  const map: Record<string, string> = {};
  try {
    for (const line of fs.readFileSync(path.join(MEMORY_DIR, "settings", "voices.txt"), "utf8").split("\n")) {
      const m = line.match(/^\s*([^#=]+?)\s*=\s*([A-Za-z0-9]+)\s*$/);
      if (m) map[m[1].toLowerCase()] = m[2];
    }
  } catch {}
  return map;
}

export function setVoice(nameOrId: string): { name: string; id: string } | { error: string } {
  const q = (nameOrId ?? "").trim();
  if (!q) return { error: "no voice specified" };
  const map = readVoices();
  let id = "", name = "";
  const words = " " + q.toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  for (const nm of Object.keys(map)) {
    if (words.includes(" " + nm.replace(/[^a-z0-9]+/g, " ").trim() + " ")) { id = map[nm]; name = nm; break; }
  }
  if (!id) { const m = q.match(/\b[A-Za-z0-9]{20}\b/); if (m) { id = m[0]; name = "custom voice"; } }
  if (!id) return { error: `unknown voice "${q.slice(0, 40)}". Known: ${Object.keys(map).join(", ") || "none set"}` };
  try { fs.writeFileSync(path.join(MEMORY_DIR, "settings", "voice.txt"), id + "\n"); }
  catch { return { error: "could not save voice" }; }
  return { name, id };
}

// All Obsidian vaults workers may READ (from memory/vaults.txt) + the brain.
export function readVaults(brainDir: string): string[] {
  let list: string[] = [];
  try {
    list = fs.readFileSync(path.join(MEMORY_DIR, "vaults.txt"), "utf8").split("\n")
      .map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
      .map((l) => l.replace(/^~(?=$|\/)/, os.homedir()));
  } catch {}
  if (!list.length) list = [];   // brain is appended below — always searchable
  if (!list.includes(brainDir)) list.push(brainDir);
  return list.filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}
