import { z } from "zod";
// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { AutorecordBody, DeleteCallBody, ToggleCallItemBody, UpdateNotesBody } from "@jarvis/shared";
import {
  deleteCall, getAutorecord, listCalls, recState, setAutorecord, toggleCallItem, updateCallNotes,
} from "../services/calls.js";
import { signalWatcher } from "../integrations/watcher.js";
import { localOnly } from "../plugins/localOnly.js";
import { CALLS_DIR, JARVIS_DIR } from "../config.js";
import { WORKER_PATH } from "../services/env.js";

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

  // rerun a failed/stalled processing from the UI — spawns the pipeline
  // detached; the live channel refreshes the page as files change
  app.post("/api/calls/reprocess", { preHandler: localOnly }, async (req, reply) => {
    const body = z.object({ id: z.string().regex(/^\d{4}-\d{2}-\d{2}-\d{4}$/) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad id" });
    const sess = path.join(CALLS_DIR, body.data.id);
    if (!fs.existsSync(sess)) return reply.code(404).send({ error: "no such session" });
    try { fs.rmSync(path.join(sess, "FAILED.txt"), { force: true }); } catch {}
    const out = fs.openSync(path.join(sess, "process.log"), "a");
    const child = spawn("/bin/bash", [path.join(JARVIS_DIR, "tools", "process-call.sh"), sess], {
      cwd: JARVIS_DIR, detached: true, stdio: ["ignore", out, out],
      env: { ...process.env, PATH: WORKER_PATH },
    });
    child.unref();
    fs.closeSync(out);
    return { ok: true };
  });

  app.post("/api/calls/stoprec", { preHandler: localOnly }, async () => signalWatcher("stop"));
  app.post("/api/calls/startrec", { preHandler: localOnly }, async () => signalWatcher("start"));
}
