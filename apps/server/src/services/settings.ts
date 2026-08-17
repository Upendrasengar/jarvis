// Settings service — one API over the scattered preference files the shell
// pipeline already reads (kept as separate files on purpose: bash consumes
// them directly, and each stays independently editable):
//   memory/settings/ui.json             voiceMode (UI-only settings)
//   memory/settings/autorecord.txt      auto-record on/off (call-watch reads it)
//   memory/settings/whisper-model.txt   small | medium (process-call reads it)
//   memory/settings/retention-days.txt  audio retention (call-watch reads it)
//   memory/settings/voice.txt           ElevenLabs voice id (TTS reads it)
import fs from "node:fs";
import path from "node:path";
import type { Settings, VoicesInfo } from "@jarvis/shared";
import { JARVIS_DIR, MEMORY_DIR } from "../config.js";
import { getAutorecord, setAutorecord } from "./calls.js";
import { currentVoiceId, readVoices, setVoice } from "./env.js";

const SETTINGS_FILE = path.join(MEMORY_DIR, "settings", "ui.json");
const WHISPER_FILE = path.join(MEMORY_DIR, "settings", "whisper-model.txt");
const RETENTION_FILE = path.join(MEMORY_DIR, "settings", "retention-days.txt");
const VOICE_ACTIVE_FILE = path.join(JARVIS_DIR, "data", "voice-listening");

function readJson(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch { return {}; }
}

export function readSettings(): Settings {
  const j = readJson();
  let whisper = "medium";
  try { whisper = fs.readFileSync(WHISPER_FILE, "utf8").trim() || "medium"; } catch {}
  let retention = 7;
  try { retention = parseInt(fs.readFileSync(RETENTION_FILE, "utf8").trim(), 10) || 7; } catch {}
  // voice id → preset name when we know it
  const vid = currentVoiceId();
  const byId = Object.entries(readVoices()).find(([, id]) => id === vid);
  return {
    voiceMode: (j.voiceMode as Settings["voiceMode"]) ?? "on-demand",
    autorecord: getAutorecord().on,
    whisperModel: whisper === "small" ? "small" : "medium",
    retentionDays: Math.min(90, Math.max(1, retention)),
    voice: byId?.[0] ?? vid,
  };
}

export function patchSettings(patch: Partial<Settings>): Settings {
  if (patch.voiceMode !== undefined) {
    const j = readJson();
    j.voiceMode = patch.voiceMode;
    try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(j, null, 2) + "\n"); } catch {}
  }
  if (patch.autorecord !== undefined) setAutorecord(patch.autorecord);
  if (patch.whisperModel !== undefined) {
    try { fs.writeFileSync(WHISPER_FILE, patch.whisperModel + "\n"); } catch {}
  }
  if (patch.retentionDays !== undefined) {
    try { fs.writeFileSync(RETENTION_FILE, String(patch.retentionDays) + "\n"); } catch {}
  }
  if (patch.voice !== undefined) setVoice(patch.voice);
  return readSettings();
}

export function voicesInfo(): VoicesInfo {
  const settings = readSettings();
  return { current: settings.voice, presets: Object.keys(readVoices()) };
}

// Live "the browser mic is intentionally hot" flag — call-watch skips the
// teams-web trigger while this is fresh, so continuous listening can't
// phantom-start a call recording. Heartbeat-refreshed by the web app.
export function setVoiceListening(listening: boolean): { ok: true } {
  try {
    if (listening) {
      fs.mkdirSync(path.dirname(VOICE_ACTIVE_FILE), { recursive: true });
      fs.writeFileSync(VOICE_ACTIVE_FILE, String(Date.now()));
    } else {
      fs.rmSync(VOICE_ACTIVE_FILE, { force: true });
    }
  } catch {}
  return { ok: true };
}
