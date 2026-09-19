// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import { z } from "zod";
// Read-only content routes: digests, projects, graph, stats, health.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { JARVIS_DIR } from "../config.js";
import { updateState, isNewer } from "../services/updateCheck.js";
import type { FastifyInstance } from "fastify";
import { digestFor, listDigests } from "../services/digest.js";
import { listProjects , setProjectStatus } from "../services/projects.js";
import { buildGraph } from "../services/graph.js";
import { localOnly } from "../plugins/localOnly.js";
import { buildStats } from "../services/stats.js";


// Read once — the answer cannot change while the process is alive, and this is
// on a route the dashboard polls.
let VERSION_CACHE: { version: string; commit: string } | null = null;
function jarvisVersion(): { version: string; commit: string } {
  if (VERSION_CACHE) return VERSION_CACHE;
  let version = "";
  let commit = "";
  try {
    const a = JSON.parse(fs.readFileSync(path.join(JARVIS_DIR, "artifact.json"), "utf8"));
    if (typeof a.version === "string") version = a.version;
    if (typeof a.commit === "string") commit = a.commit;
  } catch { /* not a published install */ }
  if (!version) {
    try {
      version = execFileSync("git", ["describe", "--tags", "--always"], {
        cwd: JARVIS_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch { /* not a git checkout either */ }
  }
  VERSION_CACHE = { version: version || "unknown", commit };
  return VERSION_CACHE;
}

export function contentRoutes(app: FastifyInstance) {
  app.get("/api/digest", async (req) => {
    const date = (req.query as Record<string, string>).date ?? null;
    return { md: digestFor(date) };
  });
  app.get("/api/digests", async () => listDigests());
  app.get("/api/projects", async () => listProjects());
  app.post("/api/projects/status", { preHandler: localOnly }, async (req, reply) => {
    const b = z.object({ id: z.string(), status: z.enum(["active", "inactive"]) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad request" });
    const r = setProjectStatus(b.data.id, b.data.status);
    if ("error" in r) return reply.code(400).send(r);
    return r;
  });
  app.get("/api/graph", async () => buildGraph());
  app.get("/api/tags", async () =>
    buildGraph().nodes.filter((n) => n.group === "tag").map((n) => String(n.id).slice(1)).sort());
  app.get("/api/stats", async () => buildStats());
  // Version, resolved once at boot. Precedence matters: a published install
  // has artifact.json, which records the tag it was built from and the commit
  // inside it — that is the truth for anyone reporting a problem. A dev
  // checkout has neither, so fall back to the nearest tag. package.json is
  // last and has said "1.0.0" since the first commit.
  app.get("/api/health", async () => {
    const version = jarvisVersion();
    const upd = updateState();
    return {
      ok: true,
      server: "fastify",
      version,
      // null unless there is genuinely something newer. The check runs in the
      // background on a daily cache, so this never delays a page load.
      update: upd.latest && isNewer(upd.latest, version.version)
        ? { latest: upd.latest }
        : null,
    };
  });
}
