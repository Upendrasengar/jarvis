// Read-only content routes: digests, projects, graph, stats, health.
import type { FastifyInstance } from "fastify";
import { digestFor, listDigests } from "../services/digest.js";
import { listProjects } from "../services/projects.js";
import { buildGraph } from "../services/graph.js";
import { buildStats } from "../services/stats.js";

export function contentRoutes(app: FastifyInstance) {
  app.get("/api/digest", async (req) => {
    const date = (req.query as Record<string, string>).date ?? null;
    return { md: digestFor(date) };
  });
  app.get("/api/digests", async () => listDigests());
  app.get("/api/projects", async () => listProjects());
  app.get("/api/graph", async () => buildGraph());
  app.get("/api/stats", async () => buildStats());
  app.get("/api/health", async () => ({ ok: true, server: "fastify" }));
}
