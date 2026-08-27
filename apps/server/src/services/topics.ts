// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Topic vocabulary management — the Topics/ hub pages that call notes and
// notes link into. Rename is a MERGE: every [[old]] wikilink across the
// brain (Calls/, Notes/) and the reports call-notes copies is rewritten to
// [[new]], so the graph consolidates instead of fragmenting.
import fs from "node:fs";
import path from "node:path";
import { BRAIN_DIR, CALL_NOTES_DIR, REPORTS_DIR } from "../config.js";

const TOPICS_DIR = path.join(BRAIN_DIR, "Topics");
const NOTES_DIR = path.join(BRAIN_DIR, "Notes");
const CALLS_DIR = path.join(BRAIN_DIR, "Calls");

// Files that carry a topic wikilink or a tag. A topic is a SET, not a
// document — referencing one in chat means "everything under this", so the
// dispatcher needs the member PATHS to hand a worker, never their contents.
export function filesFor(kind: "topic" | "tag", name: string, cap = 12):
  { hub: string | null; files: string[]; total: number } {
  const needle = kind === "topic"
    ? new RegExp(`\\[\\[${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\||\\]\\])`, "i")
    : new RegExp(`(^|\\s|-\\s)#?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "im");
  const hits: string[] = [];
  for (const dir of [NOTES_DIR, CALLS_DIR]) {
    let names: string[] = [];
    try { names = fs.readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { continue; }
    for (const f of names) {
      const p = path.join(dir, f);
      let txt = "";
      try { txt = fs.readFileSync(p, "utf8"); } catch { continue; }
      if (kind === "tag") {
        // a tag counts when it is in the frontmatter tag list or written inline
        const fm = txt.match(/^---\n([\s\S]*?)\n---/);
        const inFm = fm ? new RegExp(`^\\s*-\\s*${name}\\s*$`, "im").test(fm[1]) : false;
        if (!inFm && !new RegExp(`#${name}\\b`, "i").test(txt)) continue;
      } else if (!needle.test(txt)) continue;
      hits.push(p);
    }
  }
  const hub = kind === "topic" && fs.existsSync(path.join(TOPICS_DIR, `${name}.md`))
    ? path.join(TOPICS_DIR, `${name}.md`)
    : null;
  return { hub, files: hits.slice(0, cap), total: hits.length };
}

const badName = (n: string) =>
  !n || n.length > 60 || /[/\\[\]#|]/.test(n) || n.startsWith(".") || n.includes("..");

export function listTopics(): Array<{ name: string; created: string }> {
  try {
    return fs.readdirSync(TOPICS_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const name = f.replace(/\.md$/, "");
        const created =
          fs.readFileSync(path.join(TOPICS_DIR, f), "utf8").match(/^created:\s*(\S+)/m)?.[1] ?? "";
        return { name, created };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function stub(name: string) {
  fs.mkdirSync(TOPICS_DIR, { recursive: true });
  const f = path.join(TOPICS_DIR, `${name}.md`);
  if (!fs.existsSync(f))
    fs.writeFileSync(f,
      `---\ntitle: ${name}\ncreated: ${new Date().toLocaleDateString("sv-SE")}\n---\n\nTopic hub — every call and note linking here forms this cluster.\n`);
}

export function createTopic(name: string): { ok: true } | { error: string } {
  name = name.trim();
  if (badName(name)) return { error: "bad topic name" };
  stub(name);
  return { ok: true };
}

// every file that could carry [[topic]] wikilinks
function linkableFiles(): string[] {
  const out: string[] = [];
  for (const dir of [...new Set([path.join(BRAIN_DIR, "Calls"), path.join(BRAIN_DIR, "Notes"), CALL_NOTES_DIR])]) {
    try {
      for (const f of fs.readdirSync(dir))
        if (f.endsWith(".md")) out.push(path.join(dir, f));
    } catch {}
  }
  return out;
}

export function renameTopic(from: string, to: string): { ok: true; rewritten: number } | { error: string } {
  from = from.trim(); to = to.trim();
  if (badName(from) || badName(to)) return { error: "bad topic name" };
  if (!fs.existsSync(path.join(TOPICS_DIR, `${from}.md`))) return { error: "no such topic" };
  let rewritten = 0;
  const needle = `[[${from}]]`;
  for (const f of linkableFiles()) {
    try {
      const txt = fs.readFileSync(f, "utf8");
      if (!txt.includes(needle)) continue;
      fs.writeFileSync(f, txt.split(needle).join(`[[${to}]]`));
      rewritten++;
    } catch {}
  }
  stub(to);
  try { fs.rmSync(path.join(TOPICS_DIR, `${from}.md`), { force: true }); } catch {}
  return { ok: true, rewritten };
}

export function deleteTopic(name: string): { ok: true } | { error: string } {
  name = name.trim();
  if (badName(name)) return { error: "bad topic name" };
  try { fs.rmSync(path.join(TOPICS_DIR, `${name}.md`), { force: true }); return { ok: true }; }
  catch { return { error: "delete failed" }; }
}
