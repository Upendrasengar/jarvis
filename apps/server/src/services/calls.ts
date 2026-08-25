// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Call sessions: list, action-item toggling, deletion, live recording state,
// auto-record preference. 1:1 port of the legacy ui/server.js behavior —
// the filesystem layout written by tools/call-watch.sh + process-call.sh is
// the interface, and markdown stays the source of truth.
import fs from "node:fs";
import path from "node:path";
import type { Call, RecState } from "@jarvis/shared";
import { BRAIN_CALLS_DIR, CALLS_DIR, CALL_NOTES_DIR, MEMORY_DIR, VAULT_DIR } from "../config.js";

// notes file resolution: our writer uses call-notes-<id>.md; Obsidian-
// converted vaults often use call-<id>.md — read whichever exists,
// write back to the one that does (default: call-notes-)
export function notesFileFor(id: string): string {
  const a = path.join(CALL_NOTES_DIR, `call-notes-${id}.md`);
  if (fs.existsSync(a)) return a;
  const b = path.join(CALL_NOTES_DIR, `call-${id}.md`);
  return fs.existsSync(b) ? b : a;
}

const STALE_MS = 30 * 60e3;

export function listCalls(): Call[] {
  const out: Call[] = [];
  let dirs: string[] = [];
  try { dirs = fs.readdirSync(CALLS_DIR); } catch { return out; }
  for (const d of dirs) {
    const sess = path.join(CALLS_DIR, d);
    try { if (!fs.statSync(sess).isDirectory()) continue; } catch { continue; }
    let meta = "";
    try { meta = fs.readFileSync(path.join(sess, "meta.txt"), "utf8"); } catch {}
    const url = meta.match(/^url:\s*(.+)$/m)?.[1] ?? "";
    const started = meta.match(/^started:\s*(.+)$/m)?.[1] ?? d;
    const ended = meta.match(/^ended:\s*(.+)$/m)?.[1] ?? "";
    const hasAudio = ["mic.wav", "system.wav", "system16.wav"]
      .some((f) => fs.existsSync(path.join(sess, f)));
    let transcript = "", notes = "";
    try { transcript = fs.readFileSync(path.join(sess, "transcript.md"), "utf8"); } catch {}
    try { notes = fs.readFileSync(notesFileFor(d), "utf8"); } catch {}
    // failed = the processor said so (FAILED.txt) or went silent 30+ min
    const failedMark = fs.existsSync(path.join(sess, "FAILED.txt"));
    let stale = false;
    try {
      stale = Date.now() - fs.statSync(path.join(sess, "process.log")).mtimeMs > STALE_MS;
    } catch {
      // no process.log at all: processing never started — judge by how long
      // ago the recording ended (meta.txt mtime)
      try { stale = !!ended && Date.now() - fs.statSync(path.join(sess, "meta.txt")).mtimeMs > 15 * 60e3; } catch {}
    }
    const status =
      !ended && hasAudio ? "recording" :
      notes              ? "done" :
      failedMark         ? "failed" :
      hasAudio           ? (stale ? "failed" : "processing") :
      transcript         ? "failed" : "empty";
    out.push({ id: d, url, started, ended, status, notes, transcript });
  }
  return out.sort((a, b) => b.id.localeCompare(a.id));
}

export function recState(): RecState {
  const rec = listCalls().find((c) => c.status === "recording");
  return rec ? { recording: true, id: rec.id, started: rec.started } : { recording: false };
}

// Toggle the Nth "- [ ]" checkbox in both the reports copy and the vault copy.
export function toggleCallItem(id: string, index: number): { ok: true } | { error: string } {
  // dedupe — in vault mode both paths can resolve to the same file, and
  // toggling it twice flips the checkbox right back
  const files = [...new Set([
    notesFileFor(id),
    path.join(BRAIN_CALLS_DIR, `call-${id}.md`),
  ])];
  let ok = false;
  for (const f of files) {
    try {
      let i = -1;
      const txt = fs.readFileSync(f, "utf8")
        .replace(/- \[( |x)\]/g, (m, c) => (++i === index ? `- [${c === " " ? "x" : " "}]` : m));
      fs.writeFileSync(f, txt);
      ok = true;
    } catch {}
  }
  return ok ? { ok: true } : { error: "notes not found" };
}

// Delete a call entirely: session dir, notes, vault copy. Refuses while the
// session is still being recorded.
export function deleteCall(id: string): { ok: true } | { error: string } {
  const sess = path.join(CALLS_DIR, id);
  try {
    const meta = fs.readFileSync(path.join(sess, "meta.txt"), "utf8");
    if (!/^ended:/m.test(meta)) return { error: "call is still recording" };
  } catch {}
  try { fs.rmSync(sess, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(path.join(CALL_NOTES_DIR, `call-notes-${id}.md`), { force: true }); } catch {}
  try { fs.rmSync(path.join(CALL_NOTES_DIR, `call-${id}.md`), { force: true }); } catch {}
  try { fs.rmSync(path.join(BRAIN_CALLS_DIR, `call-${id}.md`), { force: true }); } catch {}
  return { ok: true };
}

// Save edited notes. Vault mode: ONE canonical file in <vault>/Calls.
// Legacy mode: reports file + brain copy stay in sync as before.
export function updateCallNotes(id: string, notes: string): { ok: true } | { error: string } {
  const notesFile = notesFileFor(id);
  if (!fs.existsSync(notesFile)) return { error: "no notes exist for this call" };
  const body = notes.endsWith("\n") ? notes : notes + "\n";
  try {
    fs.writeFileSync(notesFile, body);
    if (!VAULT_DIR) {
      fs.mkdirSync(BRAIN_CALLS_DIR, { recursive: true });
      fs.writeFileSync(path.join(BRAIN_CALLS_DIR, `call-${id}.md`), body);
    }
    return { ok: true };
  } catch (e) {
    return { error: String(e).slice(0, 120) };
  }
}

const AUTOREC_FILE = path.join(MEMORY_DIR, "settings", "autorecord.txt");

export function getAutorecord(): { on: boolean } {
  try { return { on: fs.readFileSync(AUTOREC_FILE, "utf8").trim() !== "off" }; }
  catch { return { on: true }; }
}

export function setAutorecord(on: boolean): { on: boolean } {
  try { fs.writeFileSync(AUTOREC_FILE, on ? "on\n" : "off\n"); } catch {}
  return getAutorecord();
}
