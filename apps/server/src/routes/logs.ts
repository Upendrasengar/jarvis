import type { FastifyInstance } from "fastify";
import { activity, listLogs, tailLog } from "../services/logs.js";

export function logRoutes(app: FastifyInstance) {
  app.get("/api/logs", async () => listLogs());
  app.get("/api/logs/:id", async (req) => {
    const { id } = req.params as { id: string };
    const lines = Math.min(1000, Number((req.query as Record<string, string>).lines) || 200);
    return tailLog(id, lines);
  });
  app.get("/api/activity", async () => activity());
}
