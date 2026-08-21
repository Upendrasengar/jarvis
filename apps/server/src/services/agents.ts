// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Worker agents — Jarvis (the chat) is a tool-less dispatcher; real work runs
// in separate autonomous `claude` processes. Three kinds:
//   code — branches inside a project, never pushes/merges (safety rules in prompt)
//   ask  — read-only recall/lookup over vaults + projects
//   note — writes ONLY into the brain vault (memory)
// Port of the legacy orchestration, including result fold-in and auto-distill.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { BRAIN_DIR, JARVIS_DIR, setting } from "../config.js";
import { CLAUDE, WORKER_PATH, readVaults, setVoice } from "./env.js";
import { recordResult } from "./chatSessions.js";
import { pushEvent } from "../live/liveState.js";

export type AgentRecord = {
  id: string;
  kind: "code" | "ask" | "note" | "voice";
  project: string;
  path: string;
  task: string;
  branch: string;
  status: "working" | "done" | "failed" | "stopped";
  log: string[];
  started: number;
  finished: number | null;
  summary: string;
  answer: string;
  sessionId: string;
  silent: boolean;
  child?: ChildProcess;
};

const agents = new Map<string, AgentRecord>();
let seq = 0;

function baseRecord(partial: Partial<AgentRecord> & Pick<AgentRecord, "kind" | "project" | "path" | "task">): AgentRecord {
  const rec: AgentRecord = {
    id: "A" + ++seq,
    branch: "",
    status: "working",
    log: [],
    started: Date.now(),
    finished: null,
    summary: "",
    answer: "",
    sessionId: "",
    silent: false,
    ...partial,
  };
  agents.set(rec.id, rec);
  return rec;
}

function attach(rec: AgentRecord, child: ChildProcess, maxLog = 400) {
  rec.child = child;
  const push = (line: string) => { rec.log.push(line); if (rec.log.length > maxLog) rec.log.shift(); };
  child.stdout?.on("data", (d) => String(d).split("\n").forEach((l) => l.trim() && push(l)));
  child.stderr?.on("data", (d) => { const s = String(d); if (!/no stdin|Warning/.test(s)) push("⚠ " + s.trim()); });
  return push;
}

export function resolveProject(name: string): { name: string; path: string } | null {
  const base = path.join(os.homedir(), "Documents/Projects");
  const q = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {}
  const hit = dirs.find((d) => d.toLowerCase().replace(/[^a-z0-9]/g, "") === q)
    ?? dirs.find((d) => d.toLowerCase().replace(/[^a-z0-9]/g, "").includes(q));
  if (hit) return { name: hit, path: path.join(base, hit) };
  for (const p of ["Upen/upen-git", "mcps"]) {
    try {
      const sub = fs.readdirSync(path.join(base, p), { withFileTypes: true })
        .filter((e) => e.isDirectory()).map((e) => e.name);
      const h = sub.find((d) => d.toLowerCase().replace(/[^a-z0-9]/g, "").includes(q));
      if (h) return { name: h, path: path.join(base, p, h) };
    } catch {}
  }
  return null;
}

export function spawnAgent(project: string, task: string, sessionId = "") {
  const proj = resolveProject(project);
  if (!proj) return { error: `project not found: ${project}` };
  const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "task";
  const branch = `agent/${slug}`;
  const rec = baseRecord({ kind: "code", project: proj.name, path: proj.path, task, branch, sessionId });

  const prompt = [
    `You are an autonomous worker agent operating INSIDE the project "${proj.name}" at ${proj.path}.`,
    `TASK: ${task}`,
    ``,
    `Rules (strict):`,
    `- First create and switch to a new branch: git checkout -b ${branch} (from the current branch).`,
    `- Make the SMALLEST change that accomplishes the task, matching existing code style.`,
    `- You MAY read, edit, and run build/test commands. Do NOT push, do NOT merge, do NOT force-push,`,
    `  and NEVER commit to or modify main/master/develop directly.`,
    `- If the task is unclear or risky, STOP and explain what you need instead of guessing.`,
    `- When finished, end your response with a section "SUMMARY:" containing: what you changed,`,
    `  files touched, whether build/tests pass, and the branch name. Keep it under 8 lines.`,
    `Work now and report.`,
  ].join("\n");

  const child = spawn(CLAUDE, ["-p", prompt, "--model", "sonnet",
    "--add-dir", proj.path, "--dangerously-skip-permissions"],
    { cwd: proj.path, env: { ...process.env, PATH: WORKER_PATH }, stdio: ["ignore", "pipe", "pipe"] });
  attach(rec, child);
  child.on("close", (code) => {
    rec.status = code === 0 ? "done" : "failed";
    const full = rec.log.join("\n");
    const m = full.match(/SUMMARY:\s*([\s\S]*)$/i);
    rec.summary = (m ? m[1] : rec.log.slice(-6).join(" ")).trim().slice(0, 600);
    rec.finished = Date.now();
    recordResult(rec.sessionId, rec.task, `Finished on branch ${branch}. ${rec.summary}`);
    if (rec.sessionId) pushEvent({ type: "worker-result", sessionId: rec.sessionId });
    if (rec.status === "done" && rec.summary)
      autoDistill(`Code task in ${proj.name}: ${rec.task}\nOutcome: ${rec.summary} (branch ${branch})`);
  });
  return { id: rec.id, project: proj.name, branch, status: rec.status };
}

export function spawnAsk(task: string, sessionId = "") {
  const rec = baseRecord({ kind: "ask", project: "recall", path: JARVIS_DIR, task, sessionId });
  const prompt = [
    "You are a worker for Jarvis. Do the task below, then report a concise, spoken-friendly answer.",
    "TASK: " + task,
    "",
    "You MAY read files, run read-only shell (git log/status, grep, the tools/*.sh scripts in ~/jarvis),",
    "and search the Obsidian vaults. Do NOT write or modify anything. Be quick.",
    "TOPIC GRAPH: calls and notes carry [[Topic]] wikilinks; hub pages live in the brain vault's Topics/ folder. For 'related to X' / 'everything about X' questions, grep the vaults for the literal text [[X]] (e.g. grep -rl \"[[Claims]]\") and read those files — that is the curated cluster, more precise than keyword search.",
    "End your reply with a line 'ANSWER:' then 1-4 plain sentences a voice assistant can read aloud (no markdown, lists, or code).",
    "If the answer draws on specific call notes or notes, add ONE final line after those sentences:",
    "SOURCES: /calls/<id> /notes/<id> ...",
    "where <id> for calls is the YYYY-MM-DD-HHMM stamp from call-notes-<id>.md (or Calls/call-<id>.md), and for notes is the Notes/ filename without .md (URL-encode spaces as %20). List ONLY files you actually used, space-separated, max 6.",
  ].join("\n");
  // code workers may also roam your projects folder (memory/settings/code-root.txt)
  const codeRoot = setting("code-root");
  const addDirs = [...readVaults(BRAIN_DIR), ...(codeRoot ? [codeRoot] : [])]
    .flatMap((d) => ["--add-dir", d]);
  const child = spawn(CLAUDE, ["-p", prompt, "--model", "sonnet", ...addDirs, "--dangerously-skip-permissions"],
    { cwd: JARVIS_DIR, env: { ...process.env, PATH: WORKER_PATH }, stdio: ["ignore", "pipe", "pipe"] });
  attach(rec, child);
  child.on("close", (code) => {
    rec.status = code === 0 ? "done" : "failed";
    const m = rec.log.join("\n").match(/ANSWER:\s*([\s\S]*)$/i);
    rec.answer = (m ? m[1] : rec.log.slice(-4).join(" ")).trim().slice(0, 800);
    rec.summary = rec.answer.slice(0, 120);
    rec.finished = Date.now();
    recordResult(rec.sessionId, rec.task, rec.answer);
    if (rec.sessionId) pushEvent({ type: "worker-result", sessionId: rec.sessionId });
    if (rec.status === "done" && rec.answer) autoDistill(`Task: ${rec.task}\nResult: ${rec.answer}`);
  });
  return { id: rec.id, kind: "ask", status: rec.status };
}

export function spawnNote(content: string, opts: { sessionId?: string; auto?: boolean } = {}) {
  const rec = baseRecord({
    kind: "note", project: "memory", path: BRAIN_DIR, task: (content ?? "").slice(0, 120),
    sessionId: opts.sessionId ?? "", silent: !!opts.auto,
  });
  const prompt = [
    `You maintain Jarvis's personal memory vault (Obsidian markdown) at ${BRAIN_DIR}.`,
    `Consider recording this so Jarvis can recall it later:`,
    `"""`, content, `"""`, ``,
    `Rules:`,
    `- Write ONLY inside ${BRAIN_DIR}. Create or update the most relevant .md file; organize by topic with clear filenames.`,
    `- The user's own notes live in ${BRAIN_DIR}/Notes/ (one .md per topic; frontmatter: title, created, optional 'call: <call-id>' when tied to a recorded call; '- [ ]' lines become tracked action items). When the user asks to create/update MY NOTE about something, work there.`,
    `- Append as a short dated bullet; keep it tidy and Obsidian-style ([[links]] where natural). Don't duplicate facts already there.`,
    `- Connect notes into the topic graph: Topics/ holds hub pages ([[Claims]], [[DAP]] etc.) — add matching [[Topic]] wikilinks when the note clearly belongs to an existing topic.`,
    `- If it's trivial, transient, or not worth remembering, write NOTHING and reply exactly: SKIP`,
    `- End with 'ANSWER:' then ONE short sentence saying what you saved (or that nothing was saved).`,
  ].join("\n");
  const child = spawn(CLAUDE, ["-p", prompt, "--model", "haiku", "--add-dir", BRAIN_DIR, "--dangerously-skip-permissions"],
    { cwd: BRAIN_DIR, env: { ...process.env, PATH: WORKER_PATH }, stdio: ["ignore", "pipe", "pipe"] });
  attach(rec, child, 200);
  child.on("close", (code) => {
    rec.status = code === 0 ? "done" : "failed";
    const m = rec.log.join("\n").match(/ANSWER:\s*([\s\S]*)$/i);
    rec.answer = (m ? m[1] : "").trim().slice(0, 300);
    rec.summary = rec.answer.slice(0, 120);
    rec.finished = Date.now();
    if (!rec.silent) {
      recordResult(rec.sessionId, "note", rec.answer);
      if (rec.sessionId) pushEvent({ type: "worker-result", sessionId: rec.sessionId });
    }
  });
  return { id: rec.id, kind: "note", status: rec.status };
}

function autoDistill(content: string) {
  try { spawnNote(content, { auto: true }); } catch {}
}

export function dispatchDelegate(d: { type?: string; project?: string; task?: string }, sessionId = "") {
  const task = (d?.task ?? "").trim();
  if (!task) return { error: "empty task" };
  if (d.type === "voice") {
    const r = setVoice(task);
    const answer = "error" in r ? r.error : `Voice changed to ${r.name}.`;
    const rec = baseRecord({ kind: "voice", project: "voice", path: "", task, sessionId });
    rec.status = "error" in r ? "failed" : "done";
    rec.finished = Date.now();
    rec.summary = rec.answer = answer;
    if (!("error" in r)) recordResult(sessionId, "voice change", answer);
    return { id: rec.id, kind: "voice", status: rec.status, answer };
  }
  if (d.type === "note") return spawnNote(task, { sessionId });
  if (d.type === "code" && d.project) {
    const r = spawnAgent(d.project, task, sessionId);
    return "error" in r ? spawnAsk(task, sessionId) : r;
  }
  return spawnAsk(task, sessionId);
}

export function agentList() {
  return [...agents.values()].map((a) => ({
    id: a.id, kind: a.kind, project: a.project, task: a.task, branch: a.branch,
    status: a.status, started: a.started, finished: a.finished, silent: a.silent,
    lastLine: (a.log[a.log.length - 1] ?? "").slice(0, 100),
    summary: a.summary, answer: a.answer, logLines: a.log.length,
  }));
}

export function agentLog(id: string) {
  const a = agents.get(id);
  return a ? { id, status: a.status, log: a.log, summary: a.summary } : null;
}

export function agentStop(id: string) {
  const a = agents.get(id);
  if (a?.child) { try { a.child.kill(); } catch {} a.status = "stopped"; }
  return { stopped: true };
}
