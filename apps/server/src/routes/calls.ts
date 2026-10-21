import { z } from "zod";
// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { FastifyInstance } from "fastify";
import {
  AutorecordBody, DeleteCallBody, LiveDefaultBody, LiveDoneBody, LiveToggleBody, ProcessPauseBody, ProcessPolicy,
  StopRecBody, ToggleCallItemBody, UpdateNotesBody,
} from "@jarvis/shared";
import {
  deleteCall, getAutorecord, listCalls, recState, setAutorecord, toggleCallItem, updateCallNotes,
} from "../services/calls.js";
import { signalWatcher } from "../integrations/watcher.js";
import { localOnly } from "../plugins/localOnly.js";
import { getMicMute, setMicMute } from "../services/micMute.js";
import { CALLS_DIR, JARVIS_DIR } from "../config.js";
import { WORKER_PATH } from "../services/env.js";
import { queueState, setPause, setPolicy, stopAny, stopSession } from "../services/processQueue.js";
import { getLiveDefault, liveInfo, markDone, setLive, setLiveDefault } from "../services/liveAssist.js";

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
    const r = await deleteCall(body.data.id);
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
    // JARVIS_PROCESS_FG: the owner pressed the button and is waiting, so the
    // run keeps normal CPU priority instead of the queue's background tier.
    const child = spawn("/bin/bash", [path.join(JARVIS_DIR, "tools", "process-call.sh"), sess], {
      cwd: JARVIS_DIR, detached: true, stdio: ["ignore", out, out],
      env: { ...process.env, PATH: WORKER_PATH, JARVIS_PROCESS_FG: "1" },
    });
    child.unref();
    fs.closeSync(out);
    return { ok: true };
  });

  // Stop a recording. With an id, stop THAT session — owned by the live
  // watcher or orphaned by a dead one — without touching any other. Without
  // one, the watcher's current recording plus any orphans.
  app.post("/api/calls/stoprec", { preHandler: localOnly }, async (req, reply) => {
    const body = StopRecBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "bad id" });
    const r = body.data.id ? await stopSession(body.data.id) : await stopAny();
    if ("error" in r) return reply.code(500).send(r);
    return r;
  });
  app.post("/api/calls/startrec", { preHandler: localOnly }, async () => signalWatcher("start"));

  // Processing policy + pause — when finished calls get transcribed.
  app.get("/api/process-queue", async () => queueState());
  app.post("/api/process-policy", { preHandler: localOnly }, async (req, reply) => {
    const b = ProcessPolicy.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad policy" });
    return setPolicy(b.data);
  });
  app.post("/api/process-pause", { preHandler: localOnly }, async (req, reply) => {
    const b = ProcessPauseBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad body" });
    return setPause(b.data.on, b.data.minutes ? b.data.minutes * 60e3 : undefined);
  });

  // Live assist — per-call switch, what the script has produced, ticked items.
  app.get("/api/calls/live/:id", async (req, reply) => {
    const id = String((req.params as { id: string }).id ?? "");
    if (!/^[\w-]+$/.test(id)) return reply.code(400).send({ error: "bad id" });
    return liveInfo(id);
  });
  app.post("/api/calls/live", { preHandler: localOnly }, async (req, reply) => {
    const b = LiveToggleBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad body" });
    if (!fs.existsSync(path.join(CALLS_DIR, b.data.id))) return reply.code(404).send({ error: "no such session" });
    return setLive(b.data.id, b.data.on);
  });
  app.post("/api/calls/live-done", { preHandler: localOnly }, async (req, reply) => {
    const b = LiveDoneBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad body" });
    return markDone(b.data.id, b.data.itemId, b.data.done);
  });
  app.get("/api/live-assist-default", async () => getLiveDefault());
  app.post("/api/live-assist-default", { preHandler: localOnly }, async (req, reply) => {
    const b = LiveDefaultBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad body" });
    return setLiveDefault(b.data.on);
  });

  app.get("/api/mic-mute", async () => getMicMute());
  app.post("/api/mic-mute", { preHandler: localOnly }, async (req, reply) => {
    const b = z.object({ on: z.boolean(), minutes: z.number().int().min(1).max(480).optional() })
      .safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad body" });
    return setMicMute(b.data.on, b.data.minutes ? b.data.minutes * 60e3 : undefined);
  });
}
