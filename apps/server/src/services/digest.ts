// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Daily digest markdown, written by tools/run-digest.sh into reports/.
import fs from "node:fs";
import path from "node:path";
import type { DigestEntry } from "@jarvis/shared";
import { DIGESTS_DIR } from "../config.js";

// the sidebar subtitle: first sentence of the momentum summary — a real
// hook instead of "daily digest" sixty times
function digestHook(txt: string): string {
  const body = txt.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const lines = body.split("\n");
  let cand = "";
  const si = lines.findIndex((l) => /^>\s*\[!summary\]/i.test(l));
  if (si >= 0)
    cand = lines.slice(si + 1, si + 8).filter((l) => /^>\s?/.test(l)).map((l) => l.replace(/^>\s?/, "")).join(" ");
  if (!cand) {
    const mi = lines.findIndex((l) => /^## momentum/i.test(l));
    if (mi >= 0) cand = lines.slice(mi + 1).find((l) => l.trim() && !l.startsWith("#")) ?? "";
  }
  if (!cand) cand = lines.find((l) => l.trim() && !/^[#>\-_]/.test(l)) ?? "";
  cand = cand.replace(/\*\*|__|\[\[|\]\]|`/g, "").trim();
  const sentence = cand.split(/(?<=[.!?])\s/)[0] ?? cand;
  return sentence.length > 84 ? sentence.slice(0, 81).trimEnd() + "…" : sentence;
}

export function listDigests(): DigestEntry[] {
  try {
    return fs.readdirSync(DIGESTS_DIR)
      .filter((x) => /^digest-\d{4}-\d{2}-\d{2}\.md$/.test(x))
      .map((x) => {
        let hook = "";
        try { hook = digestHook(fs.readFileSync(path.join(DIGESTS_DIR, x), "utf8")); } catch {}
        return { date: x.slice(7, 17), ...(hook ? { hook } : {}) };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch { return []; }
}

// Read a digest by date; no/invalid date → the latest one.
export function digestFor(date?: string | null): string {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    try { return fs.readFileSync(path.join(DIGESTS_DIR, `digest-${date}.md`), "utf8"); }
    catch { return `_No digest for ${date}._`; }
  }
  try {
    const f = fs.readdirSync(DIGESTS_DIR).filter((x) => x.startsWith("digest-")).sort().pop();
    return f ? fs.readFileSync(path.join(DIGESTS_DIR, f), "utf8") : "_No digest yet. Ask Jarvis to run one._";
  } catch { return "_No reports directory yet._"; }
}
