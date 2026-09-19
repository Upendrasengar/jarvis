// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Unified Actions inbox: every "- [ ] Owner: task" across all call notes.
// The index is rebuilt from the markdown whenever the notes' mtime signature
// changes — cheap (dozens of small files) and always consistent with the
// files, which remain the source of truth.
import fs from "node:fs";
import path from "node:path";
import type { ActionItem } from "@jarvis/shared";
import { CALL_NOTES_DIR, REPORTS_DIR } from "../config.js";
import { NOTES_DIR } from "./notes.js";
import { db } from "../db/index.js";
import { DONE_MARK, flipCheckbox, toggleCallItem } from "./calls.js";

let lastSignature = "";

function notesFiles(): Array<{ file: string; source: string }> {
  const out: Array<{ file: string; source: string }> = [];
  try {
    const seen = new Set<string>();
    const files = fs.readdirSync(CALL_NOTES_DIR).sort();  // call-<x> before call-notes-<x>
    for (const f of files.filter((x) => x.startsWith("call-notes-")))
      seen.add(f.replace(/^call-notes-/, ""));
    for (const f of files) {
      if (/^call-notes-[\w-]+\.md$/.test(f)) {
        out.push({ file: path.join(CALL_NOTES_DIR, f), source: f.replace(/^call-notes-/, "").replace(/\.md$/, "") });
      } else if (/^call-\d{4}-\d{2}-\d{2}-\d{4}\.md$/.test(f)) {
        // Obsidian-converted naming; skip when a call-notes- twin exists
        const stamp = f.replace(/^call-/, "");
        if (!seen.has(stamp)) out.push({ file: path.join(CALL_NOTES_DIR, f), source: stamp.replace(/\.md$/, "") });
      }
    }
  } catch {}
  try {
    for (const f of fs.readdirSync(NOTES_DIR))
      if (f.endsWith(".md"))
        out.push({ file: path.join(NOTES_DIR, f), source: "note:" + f.replace(/\.md$/, "") });
  } catch {}
  return out;
}

function signature(files: Array<{ file: string }>): string {
  return files
    .map(({ file }) => { try { return file + ":" + fs.statSync(file).mtimeMs; } catch { return file; } })
    .join("|");
}

// A call source is named "<YYYY-MM-DD>-<HHMM>" — the recording's own stamp.
// Notes that lack a "**Date/time:**" line used to fall straight through to
// the file's mtime, which lies loudly: one bulk re-sync restamps every call
// going back to August as "today", collapsing the whole ledger onto one day
// and zeroing out every age and overdue calculation downstream.
export function stampFromSource(source: string): string {
  const m = source.replace(/^note:/, "").match(/^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})/);
  return m ? `${m[1]} ${m[2]}:${m[3]}` : "";
}

function parseNotes(file: string): Omit<ActionItem, "callId">[] {
  let txt = "";
  try { txt = fs.readFileSync(file, "utf8"); } catch { return []; }
  const title = txt.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? txt.match(/^# (.+)$/m)?.[1] ?? "";
  // notes write "**Date/time:** 2026-08-11 14:30" or "… 2026-08-11 · 14:30"
  const started = (txt.match(/\*\*Date\/time:\*\*\s*([\d-]{10}(?:[ ·]+[\d:]{4,5})?)/)?.[1] ?? "")
    .replace(/[ ·]+/g, " ").trim();
  const items: Omit<ActionItem, "callId">[] = [];
  const lines = txt.split("\n");
  let idx = -1;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const m = line.match(/^- \[( |x)\] (.*)$/);
    if (!m) continue;
    idx++;
    // indented sub-bullets directly below = comments on this item
    const comments: string[] = [];
    for (let j = li + 1; j < lines.length; j++) {
      const c = lines[j].match(/^\s{2,}[-*] (.*)$/);
      if (!c) break;
      comments.push(c[1].trim());
    }
    const done = m[1] === "x";
    const doneAt = m[2].match(/<!-- done (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) -->/)?.[1] ?? "";
    const body = m[2].replace(DONE_MARK, "");
    // "- [ ] Owner: task" — owner is a short leading token before a colon
    const om = body.match(/^([A-Za-z][\w .'-]{0,24}):\s+(.*)$/);
    items.push({
      index: idx,
      owner: om ? om[1] : "",
      text: om ? om[2] : body,
      done,
      doneAt,
      callTitle: title,
      callStarted: started,
      comments,
    });
  }
  return items;
}

export function reindexActions(force = false): void {
  const files = notesFiles();
  const sig = signature(files);
  if (!force && sig === lastSignature) return;
  lastSignature = sig;

  const insert = db.prepare(
    `INSERT INTO action_items (call_id, idx, owner, text, done, call_title, call_started, comments, done_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    db.prepare("DELETE FROM action_items").run();
    for (const { file, source } of files) {
      for (const it of parseNotes(file)) {
        const started = it.callStarted || stampFromSource(source) ||
          new Date(fs.statSync(file).mtimeMs).toISOString().slice(0, 16).replace("T", " ");
        insert.run(source, it.index, it.owner, it.text, it.done ? 1 : 0, it.callTitle, started, JSON.stringify(it.comments), it.doneAt);
      }
    }
  })();
}

export function listActions(): ActionItem[] {
  reindexActions();
  const rows = db.prepare(
    `SELECT call_id, idx, owner, text, done, call_title, call_started, comments, done_at
     FROM action_items ORDER BY call_started DESC, idx ASC`
  ).all() as Array<{
    call_id: string; idx: number; owner: string; text: string;
    done: number; call_title: string; call_started: string; comments: string; done_at: string;
  }>;
  return rows.map((r) => {
    let comments: string[] = [];
    try { comments = JSON.parse(r.comments); } catch {}
    return {
      callId: r.call_id, index: r.idx, owner: r.owner, text: r.text,
      done: !!r.done, doneAt: r.done_at, callTitle: r.call_title, callStarted: r.call_started, comments,
    };
  });
}

export function toggleAction(callId: string, index: number) {
  let r: { ok: true } | { error: string };
  if (callId.startsWith("note:")) {
    const id = callId.slice(5);
    const file = path.join(NOTES_DIR, id + ".md");
    try {
      fs.writeFileSync(file, flipCheckbox(fs.readFileSync(file, "utf8"), index));
      r = { ok: true };
    } catch { r = { error: "note not found" }; }
  } else {
    r = toggleCallItem(callId, index);
  }
  if ("ok" in r) reindexActions(true);
  return r;
}

// Insert an indented comment bullet after the Nth checkbox (and after its
// existing comments). Applies to every home of the item — a note file, or a
// call's reports + vault copies.
function insertComment(txt: string, index: number, comment: string): string | null {
  const lines = txt.split("\n");
  let count = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^- \[( |x)\] /.test(lines[i])) {
      count++;
      if (count === index) {
        let j = i + 1;
        while (j < lines.length && /^\s{2,}[-*] /.test(lines[j])) j++;
        lines.splice(j, 0, `  - ${comment}`);
        return lines.join("\n");
      }
    }
  }
  return null;
}

export function commentAction(callId: string, index: number, text: string) {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const clean = `[${stamp}] ` + text.trim().replace(/\n+/g, " ");
  const targets: string[] = [];
  if (callId.startsWith("note:")) {
    targets.push(path.join(NOTES_DIR, callId.slice(5) + ".md"));
  } else {
    targets.push(path.join(CALL_NOTES_DIR, `call-notes-${callId}.md`));
    targets.push(path.join(NOTES_DIR, "..", "Calls", `call-${callId}.md`));
  }
  let ok = false;
  for (const f of targets) {
    try {
      const next = insertComment(fs.readFileSync(f, "utf8"), index, clean);
      if (next) { fs.writeFileSync(f, next); ok = true; }
    } catch {}
  }
  if (ok) reindexActions(true);
  return ok ? { ok: true as const } : { error: "item not found" };
}
