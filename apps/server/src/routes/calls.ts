import type { FastifyInstance } from "fastify";
import { AutorecordBody, DeleteCallBody, ToggleCallItemBody, UpdateNotesBody } from "@jarvis/shared";
import {
  deleteCall, getAutorecord, listCalls, recState, setAutorecord, toggleCallItem, updateCallNotes,
} from "../services/calls.js";
import { signalWatcher } from "../integrations/watcher.js";
import { localOnly } from "../plugins/localOnly.js";

export function callRoutes(app: FastifyInstance) {
  app.get("/api/calls", async () => listCalls());
  app.get("/api/recstate", async () => recState());
  app.get("/api/autorecord", async () => getAutorecord());

  app.post("/api/autorecord", { preHandler: localOnly }, async (req, reply) => {
    const body = AutorecordBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    return setAutorecord(body.data.on);
  });

  app.post("/api/calls/toggle", { preHandler: localOnly }, async (req, reply) => {
    const body = ToggleCallItemBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    const r = toggleCallItem(body.data.id, body.data.index);
    if ("error" in r) return reply.code(400).send(r);
    return r;
  });

  app.post("/api/calls/notes", { preHandler: localOnly }, async (req, reply) => {
    const body = UpdateNotesBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    const r = updateCallNotes(body.data.id, body.data.notes);
    if ("error" in r) return reply.code(400).send(r);
    return r;
  });

  app.post("/api/calls/delete", { preHandler: localOnly }, async (req, reply) => {
    const body = DeleteCallBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad id" });
    const r = deleteCall(body.data.id);
    if ("error" in r) return reply.code(400).send(r);
    return r;
  });

  app.post("/api/calls/stoprec", { preHandler: localOnly }, async () => signalWatcher("stop"));
  app.post("/api/calls/startrec", { preHandler: localOnly }, async () => signalWatcher("start"));
}
