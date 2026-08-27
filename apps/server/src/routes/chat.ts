// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Chat (SSE via warm sessions), delegation, agents, warmup, and TTS.
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ChatRef } from "@jarvis/shared";
import { getSession, sendTurn } from "../services/chatSessions.js";
import { agentList, agentLog, agentStop, dispatchDelegate, spawnAgent } from "../services/agents.js";
import { currentVoiceId, readSecrets, CLAUDE } from "../services/env.js";
import { localOnly } from "../plugins/localOnly.js";
import { NOTES_DIR } from "../services/notes.js";
import { notesFileFor } from "../services/calls.js";

const ChatBody = z.object({
  message: z.string().min(1),
  sessionId: z.string().default(""),
  // pasted screenshots as data URLs — capped at 4 images, ~7MB each encoded
  images: z.array(z.string().max(7_000_000)).max(4).optional(),
  // @-mentioned notes/calls, resolved to paths below
  refs: z.array(ChatRef).max(8).optional(),
});

// Turn @-mentions into exact paths for the dispatcher to hand its worker.
// Deliberately does NOT read the files: the dispatcher has no tools and no
// budget for note bodies — the worker opens them. A ref whose file is missing
// is passed through as such rather than silently dropped, so Jarvis can say so
// instead of inventing an answer.
function refBlock(refs: ChatRef[] | undefined): string {
  if (!refs?.length) return "";
  const lines = refs.map((r) => {
    const p = r.kind === "call" ? notesFileFor(r.id) : path.join(NOTES_DIR, `${r.id}.md`);
    return fs.existsSync(p)
      ? `- ${r.kind} "${r.title}" → ${p}`
      : `- ${r.kind} "${r.title}" → (file not found: ${p})`;
  });
  return (
    "[REFERENCED BY THE OWNER — they picked these explicitly in the message box, " +
    "so the reference is already resolved. These are EXACT paths: when you delegate, " +
    "put the path in the task and tell the worker to read that file. Never search for " +
    "them by name and never substitute a different file.\n" +
    lines.join("\n") +
    "\n]\n\n"
  );
}
const DelegateBody = z.object({
  type: z.string().optional(),
  project: z.string().optional(),
  task: z.string().optional(),
  sessionId: z.string().optional(),
});

export function chatRoutes(app: FastifyInstance) {
  app.post("/api/chat", { preHandler: localOnly }, async (req, reply) => {
    const body = ChatBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "no message" });

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });

    let emitted = false;
    const withRefs = refBlock(body.data.refs) + body.data.message;
    const r = sendTurn(body.data.sessionId, withRefs, {
      onText: (t) => { emitted = true; try { res.write(`data: ${JSON.stringify(t)}\n\n`); } catch {} },
      onDone: (finalText) => {
        if (!emitted && finalText?.trim())
          try { res.write(`data: ${JSON.stringify(finalText)}\n\n`); } catch {}
        try { res.write(`event: done\ndata: 0\n\n`); res.end(); } catch {}
      },
    }, body.data.images ?? []);
    if (r.busy) {
      try {
        res.write(`event: err\ndata: ${JSON.stringify("busy — finishing previous turn")}\n\n`);
        res.end();
      } catch {}
    }
  });

  app.get("/api/warmup", async (req) => {
    const sid = (req.query as Record<string, string>).sessionId || "default";
    getSession(sid);
    return { warming: true };
  });

  app.post("/api/delegate", { preHandler: localOnly }, async (req, reply) => {
    const body = DelegateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    return dispatchDelegate(body.data, body.data.sessionId ?? "");
  });

  app.get("/api/agents", async () => agentList());

  app.post("/api/agents/spawn", { preHandler: localOnly }, async (req, reply) => {
    const j = z.object({ project: z.string(), task: z.string() }).safeParse(req.body);
    if (!j.success) return reply.code(400).send({ error: "need project and task" });
    return spawnAgent(j.data.project, j.data.task);
  });

  app.get("/api/agents/:id/log", async (req, reply) => {
    const r = agentLog((req.params as { id: string }).id);
    if (!r) return reply.code(404).send({ error: "no such agent" });
    return r;
  });

  app.post("/api/agents/:id/stop", { preHandler: localOnly }, async (req) =>
    agentStop((req.params as { id: string }).id));

  app.post("/api/tts", { preHandler: localOnly }, async (req, reply) => {
    const j = z.object({ text: z.string().min(1) }).safeParse(req.body);
    if (!j.success) return reply.code(400).send({ error: "no text" });
    const key = readSecrets().ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY;
    if (!key) return reply.code(501).send({ error: "no ELEVENLABS_API_KEY" });
    const clean = j.data.text.replace(/\*\*/g, "").replace(/`/g, "").slice(0, 1500);
    try {
      const r = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${currentVoiceId()}/stream?optimize_streaming_latency=3`,
        {
          method: "POST",
          headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({
            text: clean, model_id: "eleven_turbo_v2_5",
            voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.2 },
          }),
        },
      );
      if (!r.ok || !r.body)
        return reply.code(502).send({ error: "elevenlabs " + r.status });
      reply.hijack();
      reply.raw.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        reply.raw.write(Buffer.from(value));
      }
      reply.raw.end();
    } catch (e) {
      if (!reply.sent) reply.code(502).send({ error: String(e).slice(0, 200) });
    }
  });

  // health parity with the legacy server now that chat/tts live here
  app.get("/api/health2", async () => ({
    ok: true,
    claude: CLAUDE,
    elevenlabs: !!(readSecrets().ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY),
  }));
}
