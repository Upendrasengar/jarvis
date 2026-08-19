// Freeform notes — markdown files in the brain vault's Notes/ folder, so
// they're simultaneously: visible to Jarvis's note/ask workers, indexed by
// vault-search recall, browsable in Obsidian, and editable from the UI.
// Frontmatter: title / created / updated / optional call: <call-id> binding
// the note to a recorded call. "- [ ]" lines feed the unified Actions inbox.
import fs from "node:fs";
import path from "node:path";
import { BRAIN_DIR } from "../config.js";

export const NOTES_DIR = path.join(BRAIN_DIR, "Notes");

export type NoteMeta = {
  id: string;
  title: string;
  updated: number;
  call: string;
  preview: string;
  openItems: number;
};

// The Notes dir is shared with Obsidian, where "Current Action Items.md"
// is a perfectly normal filename — allow anything that can't escape the
// directory (no separators, no dot-prefix, no traversal).
const ID_RE = /^(?!\.)[^/\\]+$/;
const badId = (id: string) => !ID_RE.test(id) || id.includes("..");

function parse(md: string): { title: string; call: string; body: string } {
  const fm = md.match(/^---\n([\s\S]*?)\n---\n?/);
  const head = fm?.[1] ?? "";
  const title =
    head.match(/^title:\s*(.+)$/m)?.[1]?.trim() ??
    md.match(/^# (.+)$/m)?.[1] ?? "untitled";
  const call = head.match(/^call:\s*([\w-]+)\s*$/m)?.[1] ?? "";
  const body = fm ? md.slice(fm[0].length) : md;
  return { title, call, body };
}

export function listNotes(): NoteMeta[] {
  let files: string[] = [];
  try { files = fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith(".md")); } catch { return []; }
  const out: NoteMeta[] = [];
  for (const f of files) {
    const p = path.join(NOTES_DIR, f);
    try {
      const md = fs.readFileSync(p, "utf8");
      const { title, call, body } = parse(md);
      const preview = body.split("\n").find((l) => l.trim() && !/^#/.test(l))?.slice(0, 120) ?? "";
      out.push({
        id: path.basename(f, ".md"),
        title,
        call,
        preview,
        updated: fs.statSync(p).mtimeMs,
        openItems: (md.match(/- \[ \]/g) ?? []).length,
      });
    } catch {}
  }
  return out.sort((a, b) => b.updated - a.updated);
}

export function readNote(id: string): { md: string } | { error: string } {
  if (badId(id)) return { error: "bad id" };
  try { return { md: fs.readFileSync(path.join(NOTES_DIR, id + ".md"), "utf8") }; }
  catch { return { error: "note not found" }; }
}

export function createNote(title: string, call?: string): { id: string } | { error: string } {
  const clean = (title || "Untitled note").trim().slice(0, 80);
  const slug =
    clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "note";
  let id = slug;
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  for (let n = 2; fs.existsSync(path.join(NOTES_DIR, id + ".md")); n++) id = `${slug}-${n}`;
  const today = new Date().toISOString().slice(0, 10);
  const fm = [
    "---",
    `title: ${clean}`,
    `created: ${today}`,
    ...(call && ID_RE.test(call) ? [`call: ${call}`] : []),
    "---",
    "",
    `# ${clean}`,
    "",
    ...(call ? [`Linked to call [[call-${call}]].`, ""] : []),
  ].join("\n");
  try {
    fs.writeFileSync(path.join(NOTES_DIR, id + ".md"), fm);
    return { id };
  } catch (e) { return { error: String(e).slice(0, 120) }; }
}

export function updateNote(id: string, md: string): { ok: true } | { error: string } {
  if (badId(id)) return { error: "bad id" };
  const p = path.join(NOTES_DIR, id + ".md");
  if (!fs.existsSync(p)) return { error: "note not found" };
  try {
    fs.writeFileSync(p, md.endsWith("\n") ? md : md + "\n");
    return { ok: true };
  } catch (e) { return { error: String(e).slice(0, 120) }; }
}

export function deleteNote(id: string): { ok: true } | { error: string } {
  if (badId(id)) return { error: "bad id" };
  try { fs.rmSync(path.join(NOTES_DIR, id + ".md"), { force: true }); return { ok: true }; }
  catch (e) { return { error: String(e).slice(0, 120) }; }
}
