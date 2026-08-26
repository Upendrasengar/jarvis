// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Warm chat-session manager — one long-lived `claude` process per
// conversation. First turn pays the cold start; every later turn is fast.
// Faithful port of the legacy manager including: session-id persistence
// (create → resume across restarts), 15-min idle kill, dead-resume healing,
// and worker-result fold-in so Jarvis "remembers" what his workers found.
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import { JARVIS_DIR, MEMORY_DIR, MEMORY_MD_DIR } from "../config.js";
import { CLAUDE, WORKER_PATH } from "./env.js";
import { SCREEN_FORMAT } from "@jarvis/shared";

const IDLE_MS = 15 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Jarvis is a TOOL-LESS dispatcher: it only talks and delegates.
const CONCISE =
  "You are Jarvis, a voice/chat assistant that TALKS and DELEGATES. You have NO tools and cannot read/write files or run commands yourself.\n" +
  "Your reply has TWO SEPARATE CHANNELS — do not blend them.\n" +
  "SCREEN (everything before the SPOKEN line):\n" + SCREEN_FORMAT + "\n" +
  "A one-fact answer is just that one sentence — no heading, no bullet. Everything longer takes the shape above. When relaying a worker's findings, keep their structure: relay, don't re-narrate.\n" +
  "VOICE: end EVERY reply with a FINAL line 'SPOKEN: ' + 1-3 plain sentences (no markdown, no lists). That line alone is read aloud, so ALL conversational phrasing belongs there and none of it on screen. EXCEPTION: an ACTION:DELEGATE turn stays ONE short plain sentence + the ACTION line, with no SPOKEN line.\n" +
  "For EVERY message, decide:\n" +
  "1) If it is answerable from your own knowledge or this conversation (definitions, advice, opinions, chit-chat, greetings, facts already discussed), just ANSWER directly and concisely.\n" +
  "2) If it needs reading or writing files, a project, your Obsidian vaults, a digest, calendar, git, or ANY real work, DO NOT attempt it. Say ONE short spoken sentence that you're on it, then on a NEW LINE emit EXACTLY:\n" +
  'ACTION:DELEGATE {"type":"ask","project":"<project name or empty>","task":"<clear self-contained instructions>"}\n' +
  'Types: "ask" = read-only lookups, recall, digests, questions about the user\'s files/vaults; "code" = change code in a specific project (worker branches safely); "note" = the user asks you to REMEMBER/save/note something durable — put the fact to remember in task, and it\'s written to your memory vault; "voice" = the user asks to change your speaking voice — put the voice name or ID in task (it applies immediately, no restart, so just confirm it\'s done — never mention servers or IDs out loud).\n' +
  "You have a growing memory vault; recall lookups can read it, so things you were told to remember can be recalled later.\n" +
  "3) If the user asks to be REMINDED of something, or wants a recurring nudge/check-in (\"remind me\", \"every Monday tell me\", \"ping me at 5\"), say ONE short sentence confirming what and when, then on a NEW LINE emit EXACTLY:\n" +
  'ACTION:REMIND {"name":"<short label>","schedule":<schedule>,"message":"<the nudge text to send>"}\n' +
  'Where <schedule> is ONE of: {"kind":"at","at":"YYYY-MM-DD HH:MM"} for one-offs (LOCAL time, 24h — compute the concrete date from context, never placeholders), or {"kind":"cron","expr":"m h dom mon dow"} for recurring (local time, e.g. every weekday 9am = "0 9 * * 1-5"). The reminder arrives as a macOS notification and a Telegram message. Do not delegate reminder creation.\n' +
  "If a worker report contains a line starting with 'SOURCES:', reproduce that line VERBATIM as the final line of your reply — the interface renders it as links to the files; never read it aloud as part of a sentence and never reformat it.\n" +
  "CORE MEMORY: your owner's memory files are included below, loaded fresh when this session started. Questions about who your owner is, their role, team, colleagues, preferences, or active projects: answer DIRECTLY from them, no delegation. They are complete copies, not snippets.\n" +
  "CRITICAL: You do NOT need tools and it is BY DESIGN that you have none. NEVER tell the user that tools, file access, or the Agent tool are unavailable, and NEVER offer manual workarounds (sed, terminal commands, 'run this yourself'). Delegating IS how you read/write files and change config, and it always works. For anything NOT covered by the core memory below (vault notes, call notes, file or project contents, config), NEVER answer from guesswork — always DELEGATE to get complete, fresh data. If unsure whether you can answer from knowledge, delegate.\n" +
  "When the user refers to something by a specific name or Title-Case title (e.g. 'Secret Remediation Checklist'), or as THEIR/MY doc, note, list, checklist, file, or project, treat it as a reference to their own files and DELEGATE a lookup — do NOT substitute a generic explanation of the concept.\n" +
  'The task text must be self-contained (the worker has no chat history); for voice changes it should be ONLY the voice name or ID (e.g. "george"). Never claim you did the work yourself; a worker does it and reports back. Never block.';

// Core memory rides in the system prompt: small owner-facts files the
// dispatcher may answer from directly (identity, team, active projects).
// Read at spawn — a recycled session picks up edits.
function memoryBrief(): string {
  let budget = 8000;
  const parts: string[] = [];
  try {
    for (const f of fs.readdirSync(MEMORY_MD_DIR).filter((f) => f.endsWith(".md")).sort()) {
      let txt = "";
      try { txt = fs.readFileSync(path.join(MEMORY_MD_DIR, f), "utf8").trim(); } catch { continue; }
      if (!txt) continue;
      const chunk = `--- memory/${f} ---\n${txt.slice(0, budget)}`;
      parts.push(chunk);
      budget -= chunk.length;
      if (budget <= 0) break;
    }
  } catch {}
  return parts.length ? `\n\n=== CORE MEMORY (owner facts — answer from these directly) ===\n${parts.join("\n\n")}` : "";
}

type Turn = { onText: (t: string) => void; onDone: (finalText?: string) => void };
type Session = {
  child: ChildProcessWithoutNullStreams;
  buf: string;
  active: Turn | null;
  idle: ReturnType<typeof setTimeout> | null;
};

const sessions = new Map<string, Session>();

// Known session ids persist so memory survives idle-kill AND server restarts.
// Reads the legacy ui/.sessions.json once so existing conversations carry over.
const SESS_FILE = path.join(JARVIS_DIR, "data", "sessions.json");
const LEGACY_SESS_FILE = path.join(JARVIS_DIR, "ui", ".sessions.json");
let known = new Set<string>();
try { known = new Set(JSON.parse(fs.readFileSync(SESS_FILE, "utf8"))); }
catch {
  try { known = new Set(JSON.parse(fs.readFileSync(LEGACY_SESS_FILE, "utf8"))); } catch {}
}
const persist = () => { try { fs.writeFileSync(SESS_FILE, JSON.stringify([...known])); } catch {} };

function spawnWarm(sessionId: string): Session {
  const usedResume = UUID_RE.test(sessionId) && known.has(sessionId);
  const sessArgs = UUID_RE.test(sessionId)
    ? (usedResume ? ["--resume", sessionId] : ["--session-id", sessionId])
    : [];
  if (UUID_RE.test(sessionId) && !known.has(sessionId)) { known.add(sessionId); persist(); }

  // cost discipline: the reminders/heartbeat session is a yes/no judgement
  // over server-gathered facts — Haiku territory. Conversations stay Sonnet.
  const model = sessionId === "reminders" ? "haiku" : "sonnet";
  const child = spawn(CLAUDE, [
    "-p", "--verbose",
    "--input-format", "stream-json", "--output-format", "stream-json",
    "--include-partial-messages", "--model", model,
    ...sessArgs,
    "--append-system-prompt", CONCISE + memoryBrief() +
      `\n\nDATE REFERENCE (local) — when the user says a weekday, use THIS mapping, never compute it: ${Array.from({ length: 8 }, (_, i) => {
        const d = new Date(Date.now() + i * 86_400_000);
        return `${d.toLocaleDateString("en-US", { weekday: "short" })}=${d.toLocaleDateString("sv-SE")}`;
      }).join(" ")} (first entry is today).`,
    "--disallowedTools", "Bash,Read,Edit,Write,Grep,Glob,WebFetch,WebSearch,Task,NotebookEdit",
  ], {
    cwd: JARVIS_DIR,
    env: { ...process.env, PATH: WORKER_PATH },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;

  const spawnedAt = Date.now();
  const s: Session = { child, buf: "", active: null, idle: null };
  child.stdout.on("data", (d: Buffer) => {
    s.buf += d.toString();
    let i: number;
    while ((i = s.buf.indexOf("\n")) >= 0) {
      const line = s.buf.slice(0, i);
      s.buf = s.buf.slice(i + 1);
      if (!line.trim() || !s.active) continue;
      let m: any;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.type === "stream_event" && m.event?.type === "content_block_delta"
          && m.event.delta?.type === "text_delta") {
        s.active.onText(m.event.delta.text);
      } else if (m.type === "result") {
        const a = s.active;
        s.active = null;
        a?.onDone(typeof m.result === "string" ? m.result : "");
      }
    }
  });
  // keep a stderr tail: when the CLI dies (not logged in, bad flag, old
  // version) the user must see WHY, not "(no reply)"
  let errTail = "";
  child.stderr.on("data", (d: Buffer) => { errTail = (errTail + d.toString()).slice(-1500); });
  child.on("error", (e) => {
    // spawn failure (ENOENT etc) — without this handler the whole server dies
    if (s.active) {
      const a = s.active;
      s.active = null;
      a.onText(`⚠️ Could not start the claude CLI (${String(e).slice(0, 80)}). Run \`jarvis doctor\`.`);
      a.onDone();
    }
    sessions.delete(sessionId);
  });
  child.on("close", (code) => {
    // a resume that dies within 3s means the on-disk session is gone
    if (usedResume && Date.now() - spawnedAt < 3000) { known.delete(sessionId); persist(); }
    if (s.active) {
      const a = s.active;
      s.active = null;
      const hint = /log ?in|unauthoriz|authent|api key|billing|credential/i.test(errTail)
        ? "Claude Code isn't logged in on this machine — open a terminal, run `claude`, and complete the login, then try again."
        : `The claude CLI exited unexpectedly (code ${code}).`;
      const detail = errTail.trim() ? `\n\n${errTail.trim().split("\n").slice(-3).join("\n")}` : "";
      a.onText(`⚠️ ${hint}${detail}`);
      a.onDone();
    }
    sessions.delete(sessionId);
  });
  sessions.set(sessionId, s);
  return s;
}

export function getSession(sessionId: string): Session {
  let s = sessions.get(sessionId);
  if (!s || s.child.killed || s.child.exitCode !== null) s = spawnWarm(sessionId);
  if (s.idle) clearTimeout(s.idle);
  s.idle = setTimeout(() => {
    try { s!.child.kill(); } catch {}
    sessions.delete(sessionId);
  }, IDLE_MS);
  return s;
}

// Worker results waiting to be folded into a session's next message.
// The worker already formatted its answer for the screen (markdown) and for
// the voice (its SPOKEN line) — keep the two apart, or the dispatcher
// paraphrases the spoken prose and the screen loses every bullet.
const sessionResults = new Map<string, Array<{ task: string; answer: string; spoken: string }>>();

export function recordResult(sessionId: string, task: string, answer: string, spoken = "") {
  if (!sessionId || !answer?.trim()) return;
  const arr = sessionResults.get(sessionId) ?? [];
  arr.push({
    task: (task ?? "").slice(0, 120),
    answer: answer.trim().slice(0, 4000),
    spoken: (spoken ?? "").trim().slice(0, 600),
  });
  while (arr.length > 6) arr.shift();
  sessionResults.set(sessionId, arr);
}

export function withPendingContext(sessionId: string, message: string): string {
  const arr = sessionResults.get(sessionId);
  if (!arr?.length) return message;
  sessionResults.delete(sessionId);
  const ctx = arr.map((r) =>
    `--- worker result (${r.task}) ---\n${r.answer}` +
    (r.spoken ? `\n--- that worker's voice line ---\n${r.spoken}` : "")).join("\n\n");
  return `[Background — results just returned by workers you dispatched.\n` +
    `RELAY the worker markdown to the screen essentially AS-IS: keep its bullets, **bold**, and [[wikilinks]], trim only what does not answer the question. Do NOT rewrite it into paragraphs and do NOT expand the voice line into your screen answer. Reproduce any SOURCES: line verbatim as your final line. Condense the voice line into your own SPOKEN line. Do NOT re-delegate what is already answered here:\n${ctx}\n]\n\nUser: ${message}`;
}

export function sendTurn(
  sessionId: string,
  message: string,
  turn: Turn,
  images: string[] = [],
): { busy: boolean } {
  const s = getSession(sessionId || "default");
  if (s.active) return { busy: true };
  s.active = turn;
  const text = withPendingContext(sessionId || "default", message);
  // pasted screenshots ride along as standard image content blocks
  const content: unknown[] = [];
  for (const img of images.slice(0, 4)) {
    const m = img.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }
  content.push({ type: "text", text });
  s.child.stdin.write(JSON.stringify({
    type: "user", message: { role: "user", content },
  }) + "\n");
  return { busy: false };
}
