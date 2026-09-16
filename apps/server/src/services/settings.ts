// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Settings service — one API over the scattered preference files the shell
// pipeline already reads (kept as separate files on purpose: bash consumes
// them directly, and each stays independently editable):
//   memory/settings/ui.json             voiceMode (UI-only settings)
//   memory/settings/autorecord.txt      auto-record on/off (call-watch reads it)
//   memory/settings/whisper-model.txt   base | small | medium (process-call reads it)
//   memory/settings/retention-days.txt  audio retention (call-watch reads it)
//   memory/settings/voice.txt           ElevenLabs voice id (TTS reads it)
import fs from "node:fs";
import path from "node:path";
import type { Settings, VoicesInfo } from "@jarvis/shared";
import { JARVIS_DIR, MEMORY_DIR } from "../config.js";
import { getAutorecord, setAutorecord } from "./calls.js";
import { currentVoiceId, readVoices, setVoice } from "./env.js";
import { modelFor, setModel } from "./models.js";

// Kept in step with tools/whisper-model.sh; anything outside this list is not
// a size Jarvis knows how to fetch.
export const WHISPER_SIZES = ["tiny", "base", "small", "medium", "large-v3"];

const SETTINGS_FILE = path.join(MEMORY_DIR, "settings", "ui.json");
const WHISPER_FILE = path.join(MEMORY_DIR, "settings", "whisper-model.txt");
const RETENTION_FILE = path.join(MEMORY_DIR, "settings", "retention-days.txt");
const VOICE_ACTIVE_FILE = path.join(JARVIS_DIR, "data", "voice-listening");

function readJson(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch { return {}; }
}

/** Which sizes exist on disk — the picker renders from this. */
export function listWhisperModels() {
  return WHISPER_SIZES.map((name) => {
    const p = path.join(JARVIS_DIR, "models", `ggml-${name}.bin`);
    let bytes = 0;
    try { bytes = fs.statSync(p).size; } catch { /* not installed */ }
    return { name, installed: bytes > 0, bytes };
  });
}

export function readSettings(): Settings {
  const j = readJson();
  let whisper = "base";
  try { whisper = fs.readFileSync(WHISPER_FILE, "utf8").trim() || "base"; } catch {}
  let retention = 7;
  try { retention = parseInt(fs.readFileSync(RETENTION_FILE, "utf8").trim(), 10) || 7; } catch {}
  // voice id → preset name when we know it
  const vid = currentVoiceId();
  const byId = Object.entries(readVoices()).find(([, id]) => id === vid);
  return {
    voiceMode: (j.voiceMode as Settings["voiceMode"]) ?? "on-demand",
    autorecord: getAutorecord().on,
    whisperModel: (WHISPER_SIZES.includes(whisper) ? whisper : "base") as Settings["whisperModel"],
    retentionDays: Math.min(90, Math.max(1, retention)),
    voice: byId?.[0] ?? vid,
    modelChat: modelFor("chat") as Settings["modelChat"],
    modelWorker: modelFor("worker") as Settings["modelWorker"],
    modelQuick: modelFor("quick") as Settings["modelQuick"],
  };
}

export function patchSettings(patch: Partial<Settings>): Settings {
  if (patch.voiceMode !== undefined) {
    const j = readJson();
    j.voiceMode = patch.voiceMode;
    try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(j, null, 2) + "\n"); } catch {}
  }
  if (patch.autorecord !== undefined) setAutorecord(patch.autorecord);
  if (patch.modelChat !== undefined) setModel("chat", patch.modelChat);
  if (patch.modelWorker !== undefined) setModel("worker", patch.modelWorker);
  if (patch.modelQuick !== undefined) setModel("quick", patch.modelQuick);
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
