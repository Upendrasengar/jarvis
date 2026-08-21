// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Daily digest markdown, written by tools/run-digest.sh into reports/.
import fs from "node:fs";
import path from "node:path";
import type { DigestEntry } from "@jarvis/shared";
import { REPORTS_DIR } from "../config.js";

export function listDigests(): DigestEntry[] {
  try {
    return fs.readdirSync(REPORTS_DIR)
      .filter((x) => /^digest-\d{4}-\d{2}-\d{2}\.md$/.test(x))
      .map((x) => ({ date: x.slice(7, 17) }))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch { return []; }
}

// Read a digest by date; no/invalid date → the latest one.
export function digestFor(date?: string | null): string {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    try { return fs.readFileSync(path.join(REPORTS_DIR, `digest-${date}.md`), "utf8"); }
    catch { return `_No digest for ${date}._`; }
  }
  try {
    const f = fs.readdirSync(REPORTS_DIR).filter((x) => x.startsWith("digest-")).sort().pop();
    return f ? fs.readFileSync(path.join(REPORTS_DIR, f), "utf8") : "_No digest yet. Ask Jarvis to run one._";
  } catch { return "_No reports directory yet._"; }
}
