// Aggregated stats for the overview. Port of the legacy buildStats.
import fs from "node:fs";
import path from "node:path";
import type { Stats } from "@jarvis/shared";
import { REPORTS_DIR } from "../config.js";
import { buildGraph } from "./graph.js";
import { listProjects } from "./projects.js";

export function buildStats(): Stats {
  const g = buildGraph();
  const projs = listProjects();
  const byCat: Record<string, number> = {};
  for (const p of projs) byCat[p.category] = (byCat[p.category] ?? 0) + 1;
  const active = projs.filter((p) => p.status === "active").length;

  let commits = 0;
  let activity: string[] = [];
  try {
    const rf = fs.readdirSync(REPORTS_DIR).filter((x) => x.startsWith("raw-")).sort().pop();
    if (rf) {
      const raw = fs.readFileSync(path.join(REPORTS_DIR, rf), "utf8");
      const lines = raw.split("\n").filter((l) => /^\s+- .*\(.*ago/.test(l));
      commits = lines.length;
      activity = lines.slice(0, 8).map((l) => l.replace(/^\s+- /, "").trim());
    }
  } catch {}

  return {
    stats: {
      activeProjects: active,
      totalProjects: projs.length,
      notes: g.nodes.length,
      links: g.links.length,
      commits7d: commits,
      mcpServers: projs.filter((p) => /mcp/i.test(p.id)).length,
      vaults: 2,
    },
    categories: byCat,
    activity,
    topNodes: g.nodes.sort((a, b) => (b.deg ?? 0) - (a.deg ?? 0)).slice(0, 8)
      .map((n) => ({ id: n.id, deg: n.deg ?? 0, group: n.group })),
    mcp: projs.filter((p) => /mcp/i.test(p.id)).map((p) => ({ id: p.id, status: p.status })),
  };
}
