// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Topic vocabulary management — the Topics/ hub pages that call notes and
// notes link into. Rename is a MERGE: every [[old]] wikilink across the
// brain (Calls/, Notes/) and the reports call-notes copies is rewritten to
// [[new]], so the graph consolidates instead of fragmenting.
import fs from "node:fs";
import path from "node:path";
import { BRAIN_DIR, CALL_NOTES_DIR, REPORTS_DIR } from "../config.js";

const TOPICS_DIR = path.join(BRAIN_DIR, "Topics");

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
