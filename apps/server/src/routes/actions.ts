// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { JARVIS_DIR } from "../config.js";
import { CommentActionBody, ToggleActionBody } from "@jarvis/shared";
import { commentAction, listActions, toggleAction } from "../services/actions.js";
import { localOnly } from "../plugins/localOnly.js";

export function actionRoutes(app: FastifyInstance) {
  app.get("/api/actions", async () => listActions());

  // attention annotations from tools/triage-actions.sh (nightly Sonnet pass)
  app.get("/api/triage", async () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(JARVIS_DIR, "data", "triage.json"), "utf8"));
    } catch {
      return { generatedAt: null, clusters: [], deadlines: {}, blocked: {}, reasons: {} };
    }
  });

  app.post("/api/actions/comment", { preHandler: localOnly }, async (req, reply) => {
    const body = CommentActionBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    const r = commentAction(body.data.callId, body.data.index, body.data.text);
    if ("error" in r) return reply.code(400).send(r);
    return r;
  });

  app.post("/api/actions/toggle", { preHandler: localOnly }, async (req, reply) => {
    const body = ToggleActionBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    const r = toggleAction(body.data.callId, body.data.index);
    if ("error" in r) return reply.code(400).send(r);
    return r;
  });
}
