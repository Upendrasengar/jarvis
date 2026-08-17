import type { FastifyInstance } from "fastify";
import { CommentActionBody, ToggleActionBody } from "@jarvis/shared";
import { commentAction, listActions, toggleAction } from "../services/actions.js";
import { localOnly } from "../plugins/localOnly.js";

export function actionRoutes(app: FastifyInstance) {
  app.get("/api/actions", async () => listActions());

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
