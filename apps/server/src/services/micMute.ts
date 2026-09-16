// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Mic mute — "I'm in a room with other people, don't capture me."
//
// Silences the MIC channel only. A call in progress keeps recording system
// audio, so the far side is still transcribed; it is the room around the
// owner that stops being recorded. audiocap writes zeroed frames rather than
// skipping them, so mic.wav and system16.wav stay the same length and the
// merge step cannot slide lines onto the wrong speaker.
//
// The state is a single file holding the epoch second it expires, because the
// recorder is a separate Swift process that has to read it too.
import fs from "node:fs";
import path from "node:path";
import { JARVIS_DIR } from "../config.js";

const FILE = path.join(JARVIS_DIR, "data", "mic-mute");
export const DEFAULT_MUTE_MS = 60 * 60e3;   // an hour

export type MicMute = { muted: boolean; until: number; minutesLeft: number };

export function getMicMute(): MicMute {
  try {
    const until = Number(fs.readFileSync(FILE, "utf8").trim()) * 1000;
    if (Number.isFinite(until) && Date.now() < until)
      return { muted: true, until, minutesLeft: Math.ceil((until - Date.now()) / 60e3) };
  } catch { /* not muted */ }
  return { muted: false, until: 0, minutesLeft: 0 };
}

/**
 * Mute expires on its own. A mute you forget about silently stops Jarvis
 * doing its job, which is worse than never having muted — so there is no
 * indefinite option, only a longer one.
 */
export function setMicMute(on: boolean, ms = DEFAULT_MUTE_MS): MicMute {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    if (!on) fs.rmSync(FILE, { force: true });
    else fs.writeFileSync(FILE, String(Math.floor((Date.now() + ms) / 1000)) + "\n");
  } catch { /* best effort — the recorder simply stays unmuted */ }
  return getMicMute();
}
