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
      if (e.isDirectory()) walk(p, group);
      else if (e.name.endsWith(".md")) {
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
      }
    }
  };
  const roots = new Set(readVaults(BRAIN_DIR));
  roots.add(PROJECTS_VAULT);
  for (const dir of roots) walk(dir, path.basename(dir));
  for (const l of links) {
    if (!nodes.has(l.target)) nodes.set(l.target, { id: l.target, group: "ref", deg: 0 });
    const s = nodes.get(l.source);
    if (s) s.deg++;
    nodes.get(l.target)!.deg++;
  }
  return { nodes: [...nodes.values()], links };
}
