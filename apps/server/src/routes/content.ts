// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import { z } from "zod";
// Read-only content routes: digests, projects, graph, stats, health.
import type { FastifyInstance } from "fastify";
import { digestFor, listDigests } from "../services/digest.js";
import { listProjects , setProjectStatus } from "../services/projects.js";
import { buildGraph } from "../services/graph.js";
import { localOnly } from "../plugins/localOnly.js";
import { buildStats } from "../services/stats.js";

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
  app.get("/api/health", async () => ({ ok: true, server: "fastify" }));
}
