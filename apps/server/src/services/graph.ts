// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Knowledge graph built from wikilinks across all configured vaults + brain.
// Faithful port of the legacy builder, including its group labels.
import fs from "node:fs";
import path from "node:path";
import type { Graph } from "@jarvis/shared";
import { BRAIN_DIR, PROJECTS_VAULT } from "../config.js";
import { readVaults } from "./env.js";

type Node = { id: string; group: string | number; path?: string; deg: number };

export function buildGraph(): Graph {
  const nodes = new Map<string, Node>();
  const links: { source: string; target: string }[] = [];
  const walk = (dir: string, group: string) => {
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      // vault housekeeping dirs stay out of the knowledge graph: daily
      // digests are a timeline (84 date-nodes = noise), Memory is prompt
      // config, dotdirs are Obsidian's own
      if (e.isDirectory()) {
        if (e.name === "Digests" || e.name === "Memory" || e.name.startsWith(".")) continue;
        walk(p, group);
      }
      else if (e.name.endsWith(".md") && !/^(digest|raw)-\d{4}-/.test(e.name)) {
        const title = path.basename(p, ".md");
        const txt = fs.readFileSync(p, "utf8");
        // status: inactive in frontmatter hides the page (and its links)
        // from the graph until it's reactivated
        if (/^status:\s*inactive\s*$/m.test(txt.slice(0, 400))) continue;
        if (!nodes.has(title)) nodes.set(title, { id: title, group, path: p, deg: 0 });
        for (const raw of txt.match(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g) ?? []) {
          const target = raw.replace(/\[\[|\]\]/g, "").split("|")[0].trim();
          links.push({ source: title, target });
        }
        // frontmatter tags become #tag nodes — a second clustering axis
        // (kind: #design, #process) orthogonal to topics (what: project names)
        const fm = txt.match(/^---\n([\s\S]*?)\n---/);
        if (fm) {
          const block = fm[1].match(/^tags:\s*\n((?:[ \t]+-[ \t]+.*\n?)*)/m);
          const inlineList = fm[1].match(/^tags:\s*\[([^\]]*)\]/m);
          const tags = block
            ? [...block[1].matchAll(/-[ \t]+(.+)/g)].map((m) => m[1].trim().replace(/^["']|["']$/g, ""))
            : inlineList ? inlineList[1].split(",").map((t) => t.trim()).filter(Boolean) : [];
          for (const t of tags) if (t) links.push({ source: title, target: `#${t.replace(/^#/, "")}` });
        }
      }
    }
  };
  const roots = new Set(readVaults(BRAIN_DIR));
  roots.add(PROJECTS_VAULT);
  for (const dir of roots) walk(dir, path.basename(dir));
  for (const l of links) {
    if (!nodes.has(l.target))
      nodes.set(l.target, { id: l.target, group: l.target.startsWith("#") ? "tag" : "ref", deg: 0 });
    const s = nodes.get(l.source);
    if (s) s.deg++;
    nodes.get(l.target)!.deg++;
  }
  // singleton tags (one note) are noise, not structure — keep tags that
  // actually connect things
  const weak = new Set([...nodes.values()].filter((n) => n.group === "tag" && n.deg < 2).map((n) => n.id));
  return {
    nodes: [...nodes.values()].filter((n) => !weak.has(n.id)),
    links: links.filter((l) => !weak.has(l.target)),
  };
}
