// Project pages from the projects vault (one .md per project with
// category/status frontmatter-ish fields).
import fs from "node:fs";
import path from "node:path";
import type { Project } from "@jarvis/shared";
import { PROJECTS_VAULT } from "../config.js";

export function listProjects(): Project[] {
  const dir = path.join(PROJECTS_VAULT, "projects");
  const out: Project[] = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      const txt = fs.readFileSync(path.join(dir, f), "utf8");
      const cat = txt.match(/^category:\s*(.+)$/m)?.[1] ?? "";
      const status = txt.match(/^status:\s*(.+)$/m)?.[1] ?? "";
      const what = (txt.split(/## What it does\s*/)[1] ?? "").trim().split("\n")[0].slice(0, 160);
      out.push({ id: path.basename(f, ".md"), category: cat.trim(), status: status.trim(), what });
    }
  } catch {}
  return out.sort((a, b) => (a.status === "active" ? -1 : 1) - (b.status === "active" ? -1 : 1));
}
